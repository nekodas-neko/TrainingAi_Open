// #2300. The trainer role is a relationship between two users (`trainer_relationships`), never a
// flag on `users` and never `isAdmin`.

export type TrainerRelationshipStatus = 'pending' | 'accepted' | 'revoked'

/**
 * The other party as the viewer may see them. Until a request is accepted, the person who SENT it
 * learns nothing about the target beyond what they typed (RV-195's rule for friend requests, kept
 * here): `id` and every field are null for a pending outgoing request.
 */
export interface TrainerCounterparty {
  id: string | null
  displayName: string | null
  name: string | null
  avatar: string | null
}

export interface TrainerRelationship {
  id: string
  trainerId: string
  /** Null for the trainer on a request the trainee has not accepted: an id is a probe result too. */
  traineeId: string | null
  status: TrainerRelationshipStatus
  createdAt: string
  updatedAt: string
  otherUser: TrainerCounterparty
}

export interface TrainerRelationships {
  /** People the viewer trains, or has asked to. */
  asTrainer: TrainerRelationship[]
  /** People who train the viewer, or have asked to. */
  asTrainee: TrainerRelationship[]
}

/** A program a trainer built for a trainee, as the trainer sees it: a summary, not the trainee's data. */
export interface AssignedProgramSummary {
  assignmentId: string
  programId: string
  name: string
  isActive: boolean
  sessionCount: number
  assignedAt: string
}

/** The same assignment from the trainee's side: who it came from. */
export interface ReceivedProgramAssignment {
  assignmentId: string
  programId: string
  name: string
  isActive: boolean
  assignedAt: string
  trainer: TrainerCounterparty
}
