import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAdmin } from "@/integrations/my-supabase/admin.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6).max(128),
  full_name: z.string().trim().min(1).max(120),
  lead_issue: z.string().trim().min(1).max(2000),
});

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = getAdmin();
  // generateLink resolves an existing user without scanning the full user list
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error || !data.user?.id) return null;
  return data.user.id;
}

/**
 * Create an Inner Circle account with email already confirmed so
 * sign-in works immediately (no "confirm your email" / invalid-credentials trap).
 */
export const registerInnerCircle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegisterSchema.parse(d))
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const email = data.email.trim().toLowerCase();

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        lead_issue: data.lead_issue,
      },
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        const existingId = await findUserIdByEmail(email);
        if (!existingId) {
          throw new Error(
            "That email already has an account, but we could not update it. Try Sign in.",
          );
        }
        // Early-access Inner Circle: signing up again with the same email
        // sets the password they just typed so they can get in immediately.
        const { error: updateError } = await admin.auth.admin.updateUserById(existingId, {
          password: data.password,
          email_confirm: true,
          user_metadata: {
            full_name: data.full_name,
            lead_issue: data.lead_issue,
          },
        });
        if (updateError) throw new Error(updateError.message || "Could not update account.");

        await admin.from("profiles").upsert(
          {
            id: existingId,
            email,
            full_name: data.full_name,
          },
          { onConflict: "id" },
        );

        return { ok: true as const, userId: existingId, reset: true as const };
      }
      throw new Error(error.message || "Could not create account.");
    }

    const user = created.user;
    if (!user?.id) throw new Error("Account created but user id missing.");

    await admin.from("profiles").upsert(
      {
        id: user.id,
        email,
        full_name: data.full_name,
      },
      { onConflict: "id" },
    );

    return { ok: true as const, userId: user.id };
  });

const RepairSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

/**
 * If sign-in fails with invalid credentials, confirm the email when the user
 * exists so a correct password can succeed on the next attempt.
 */
export const repairAuthEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RepairSchema.parse(d))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { repaired: false as const, exists: false as const };

    try {
      const existingId = await findUserIdByEmail(email);
      if (!existingId) return { repaired: false as const, exists: false as const };
      await getAdmin().auth.admin.updateUserById(existingId, { email_confirm: true });
      return { repaired: true as const, exists: true as const };
    } catch {
      return { repaired: false as const, exists: false as const };
    }
  });

/** Whether an email already has an account (clearer sign-in errors). */
export const checkAuthEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RepairSchema.parse(d))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { exists: false as const };
    try {
      const id = await findUserIdByEmail(email);
      return { exists: !!id };
    } catch {
      return { exists: false as const };
    }
  });
