import "next-auth"
import "next-auth/jwt"
import type { ActivityLevel } from "@trainingai/shared/types/user"

declare module "next-auth" {
  interface Session {
    // No `refreshToken` here on purpose (RV-193) — this interface is the shape handed to page
    // JavaScript by `GET /api/auth/session`. It stays on `JWT` below, where the server reads it.
    isActive?: boolean
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      timezone?: string
      isAdmin?: boolean
      sex?: string | null
      heightCm?: number | null
      dateOfBirth?: string | null
      activityLevel?: ActivityLevel | null
      friendCode?: string | null
      equippedTitle?: string | null
    }
  }
  interface User {
    isActive?: boolean
    isAdmin?: boolean
    timezone?: string
    sex?: string | null
    heightCm?: number | null
    dateOfBirth?: string | null
    activityLevel?: ActivityLevel | null
    friendCode?: string | null
    equippedTitle?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string
    refreshToken?: string
    isActive?: boolean
    /** Epoch ms of the last DB re-read of isActive — see auth.ts's jwt callback. */
    isActiveCheckedAt?: number
    isAdmin?: boolean
    timezone?: string
    sex?: string | null
    heightCm?: number | null
    dateOfBirth?: string | null
    activityLevel?: ActivityLevel | null
    friendCode?: string | null
    equippedTitle?: string | null
  }
}
