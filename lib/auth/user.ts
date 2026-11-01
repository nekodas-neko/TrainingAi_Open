import type { User } from 'next-auth'
import type { User as AccountUser } from '@trainingai/shared/types/user'
import { dataEpochOf } from './session-cutoff'

export function userClaims(user: AccountUser): Pick<User,
  'id' | 'dataEpoch' | 'isActive' | 'isAdmin' | 'timezone' | 'sex' | 'heightCm' |
  'dateOfBirth' | 'activityLevel' | 'friendCode' | 'equippedTitle'
> {
  return {
    id: user.id,
    // #3369: stamped into the token so the edge can compare a device's epoch without a database read.
    dataEpoch: dataEpochOf(user.sessionsValidFrom),
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
