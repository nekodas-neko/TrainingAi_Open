import type { User } from 'next-auth'
import type { User as AccountUser } from '@trainingai/shared/types/user'

export function userClaims(user: AccountUser): Pick<User,
  'id' | 'isActive' | 'isAdmin' | 'timezone' | 'sex' | 'heightCm' |
  'dateOfBirth' | 'activityLevel' | 'friendCode' | 'equippedTitle'
> {
  return {
    id: user.id,
    isActive: user.isActive,
    isAdmin: user.isAdmin,
    timezone: user.timezone,
    sex: user.sex ?? null,
    heightCm: user.heightCm ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    activityLevel: user.activityLevel ?? null,
    friendCode: user.friendCode ?? null,
    equippedTitle: user.equippedTitle ?? null,
  }
}
