import { getPool } from './client'

/**
 * Tell the `claude_readonly` role whose rows it may see (Q-456).
 *
 * The owner's user id used to be interpolated into every `claude_ro` view, and the generated SQL is
 * committed — so it sat in 18 tracked files, and the documented process re-published it on every
 * schema change. The views now read `current_setting('app.claude_ro_owner', true)` instead, which
 * leaves the id to be supplied at runtime.
 *
 * Supplying it here rather than asking for one manual `ALTER ROLE` is the difference between a
 * deploy that configures itself and a deploy that silently answers **zero rows** to every audit
 * query until somebody remembers. The fail-closed direction is right; needing a human to undo it on
 * every fresh database is not. This is the same shape as `bootstrapAdmin` above: a privileged write
 * at boot, from an environment variable, on the app's own connection — which already creates
 * schemas and applies migrations, so it is not new authority.
 *
 * **Resolution order, most explicit first.** `CLAUDE_RO_OWNER_USER_ID` is the dedicated variable and
 * the one to set if the audit scope should ever differ from the owner. The other two are the same
 * person by construction — `ADMIN_EXPORT_USER_ID` is who the day-review export answers for, and
 * `WEBHOOK_USER_ID` is the fallback `CLAUDE.md` already documents for it — so falling back means a
 * database that is already configured needs nothing added. The log line says which one was used,
 * because a scope silently following a variable set for a different purpose is the failure mode
 * this ordering accepts in exchange for needing no action.
 *
 * **Unset is not an error.** No variable, no `ALTER ROLE`, and the views keep returning nothing —
 * the same fail-closed state, announced rather than mysterious.
 */
export async function bootstrapClaudeRoOwner(): Promise<void> {
  if (!process.env.DATABASE_URL) return
  const source = (['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID'] as const)
    .find(k => process.env[k])
  const owner = source ? process.env[source] : undefined
  if (!owner) {
    console.warn('[instrumentation] claude_ro owner not configured — the audit views will return ZERO rows. ' +
      'Set CLAUDE_RO_OWNER_USER_ID (or ADMIN_EXPORT_USER_ID / WEBHOOK_USER_ID).')
    return
  }
  // `ALTER ROLE … SET` takes no bind parameter, so the value is interpolated — which makes this
  // regex the safety boundary, not validation. Same rule as the VACUUM allowlist.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) {
    console.error(`[instrumentation] ${source} is not a uuid — refusing to set the claude_ro owner.`)
    return
  }
  try {
    const pool = getPool()
    const { rows } = await pool.query(
      `SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
       WHERE r.rolname = 'claude_readonly'`,
    )
    if (rows.length === 0) {
      const { rows: exists } = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = 'claude_readonly'`)
      // The role is created out-of-band (it carries a password). On a database that has no
      // claude_readonly there is nothing to configure and nothing wrong.
      if (exists.length === 0) return
    }
    const current = (rows[0]?.setconfig as string[] | undefined)
      ?.find(c => c.startsWith('app.claude_ro_owner='))?.split('=')[1]
    if (current === owner) return   // already correct — say nothing on every boot
    await pool.query(`ALTER ROLE claude_readonly SET app.claude_ro_owner = '${owner}'`)
    console.info(`[instrumentation] claude_ro owner set from ${source}`)
  } catch (err) {
    // Never fatal. A database whose app user cannot ALTER ROLE still serves every request; only the
    // audit endpoint degrades, and it degrades closed.
    console.error('[instrumentation] claude_ro owner bootstrap failed:', String(err).slice(0, 300))
  }
}
