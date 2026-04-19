import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { userIdentityAudit } from "../db/identity-schema";

type Db = ReturnType<typeof drizzle>;

export type IdentityAction =
  | "email_added"
  | "email_removed"
  | "email_promoted_primary"
  | "email_verified"
  | "recovery_approved"
  | "recovery_banner_dismissed";

/**
 * Write an audit record for an identity-related action.
 *
 * Actor format:
 * - "self" — user performed the action on their own account
 * - `admin:<email>` — admin (given by email) performed the action
 * - "system" — automated process (e.g., cron, webhook)
 *
 * Details are JSON-serialized; pass `undefined` to store NULL.
 */
export async function logIdentityEvent(
  db: Db,
  event: {
    userId: string;
    action: IdentityAction;
    actor: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(userIdentityAudit).values({
    id: nanoid(),
    userId: event.userId,
    action: event.action,
    actor: event.actor,
    details: event.details ? JSON.stringify(event.details) : null,
    createdAt: new Date(),
  });
}
