import "next-auth"
import "next-auth/jwt"
import type { ActivityLevel } from "@trainingai/shared/types/user"

declare module "next-auth" {
  interface Session {
    isActive?: boolean
    /** #3369: when this sign-in happened, in seconds. Compared with `users.sessions_valid_from`. */
    signedInAt?: number
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
    /** #3369: the account's data epoch (whole seconds of its last admin reset, 0 never) at sign-in. */
    dataEpoch?: number
    mobileState?: string
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

    isActiveCheckedAt?: number
    /** #3369: stamped once at sign-in and carried through every re-issue of the token. */
    signedInAt?: number
    /** #3369: the account's data epoch when this sign-in happened. A write must come from a device that has seen it. */
    dataEpoch?: number
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
