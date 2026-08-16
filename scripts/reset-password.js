// Account-recovery script: sets a user's password directly against DATABASE_URL,
// bypassing the app entirely. Run from a Railway shell (or locally against the
// dev DB) when credentials are forgotten and the Google OAuth grant is also
// unavailable. See docs/runbooks/account-recovery.md.
//
// Usage: DATABASE_URL=... node scripts/reset-password.js <email> <newPassword>
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

async function main() {
  const [email, newPassword] = process.argv.slice(2)
  if (!email || !newPassword) {
    console.error('Usage: node scripts/reset-password.js <email> <newPassword>')
    process.exit(1)
  }
  if (newPassword.length < 8) {
    console.error('Password must be at least 8 characters.')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const hash = await bcrypt.hash(newPassword, 12)
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email',
      [hash, email],
    )
    if (result.rowCount === 0) {
      console.error(`No user found with email ${email}`)
      process.exit(1)
    }
    console.log(`Password reset for ${result.rows[0].email} (id ${result.rows[0].id}).`)
  } finally {
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
