import { admin } from "../_shared/db.ts";
import { authenticate, deviceOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { syncRequestSchema } from "../_shared/validation.ts";
import { applyDeviceStatus, readSettings } from "../_shared/device.ts";
import { interact } from "../_shared/pet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = deviceOnly(await authenticate(req, { allowUser: false, allowDevice: true }));
    const body = await parseJson(req, syncRequestSchema);
    const allowed = await enforceRateLimit("agnes-sync", auth.deviceId, 60, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many sync requests", 429);

    const petEvents = body.pet_events ?? [];
    const syncNotes = body.notes ?? [];
    const deviceEvents = body.device_events ?? [];
    const commandsAck = body.commands_ack ?? [];
    const notificationsRead = body.notifications_read ?? [];

    const now = new Date().toISOString();
    if (body.status) {
      await applyDeviceStatus(auth.deviceId, auth.userId, body.status);
    } else {
      await admin()
        .from("agnes_devices")
        .update({ last_seen_at: now })
        .eq("id", auth.deviceId)
        .eq("user_id", auth.userId)
        .is("revoked_at", null);
    }

    // Expire stale queue entries so the dashboard never shows a live PENDING
    // command the device can no longer receive.
    await admin()
      .from("agnes_device_commands")
      .update({ status: "EXPIRED" })
      .eq("device_id", auth.deviceId)
      .eq("user_id", auth.userId)
      .in("status", ["PENDING", "RECEIVED", "EXECUTING"])
      .lt("expires_at", now);

    const petRejections: { client_event_id: string; code: string }[] = [];
    const achievements = new Set<string>();
    for (const event of petEvents) {
      try {
        const result = await interact(
          auth.userId,
          event.event_type,
          "device",
          auth.deviceId,
          `dev:${event.client_event_id}`.slice(0, 80),
        );
        for (const achievement of result.achievements) achievements.add(achievement);
      } catch (error) {
        petRejections.push({
          client_event_id: event.client_event_id,
          code: error instanceof ApiError ? error.code : "pet_failed",
        });
      }
    }

    // Notes: only newer local versions win. Never overwrite another user's row.
    for (const note of syncNotes) {
      const { data: existing, error: readError } = await admin()
        .from("agnes_notes")
        .select("id, user_id, version")
        .eq("id", note.id)
        .maybeSingle();
      if (readError) continue;
      if (existing && existing.user_id !== auth.userId) continue;
      if (!existing) {
        await admin().from("agnes_notes").insert({
          id: note.id,
          user_id: auth.userId,
          device_id: auth.deviceId,
          title: note.title,
          body: note.body,
          pinned: note.pinned,
          version: note.version,
          deleted_at: note.deleted ? now : null,
        });
        continue;
      }
      if (note.version <= existing.version) continue;
      await admin()
        .from("agnes_notes")
        .update({
          title: note.title,
          body: note.body,
          pinned: note.pinned,
          version: note.version,
          deleted_at: note.deleted ? now : null,
          device_id: auth.deviceId,
        })
        .eq("id", note.id)
        .eq("user_id", auth.userId);
    }

    if (deviceEvents.length > 0) {
      await admin().from("agnes_device_events").upsert(
        deviceEvents.map((event) => ({
          user_id: auth.userId,
          device_id: auth.deviceId,
          type: event.type,
          severity: event.severity,
          message: event.message ?? null,
          payload: event.payload,
          client_event_id: event.client_event_id,
        })),
        { onConflict: "device_id,client_event_id", ignoreDuplicates: true },
      );
    }

    // Command acknowledgements (never allow arbitrary status strings).
    if (commandsAck.length > 0) {
      const ids = commandsAck.map((ack) => ack.id);
      const { data: commands } = await admin()
        .from("agnes_device_commands")
        .select("id, status")
        .eq("device_id", auth.deviceId)
        .eq("user_id", auth.userId)
        .in("id", ids);
      const byId = new Map((commands ?? []).map((command) => [command.id, command]));
      for (const ack of commandsAck) {
        const command = byId.get(ack.id);
        if (!command) continue;
        if (command.status === "COMPLETED" || command.status === "FAILED" || command.status === "EXPIRED") continue;
        const update: Record<string, unknown> = { status: ack.status, error: ack.error ?? null };
        if (ack.status === "RECEIVED") update.received_at = now;
        if (ack.status === "EXECUTING") update.started_at = now;
        if (ack.status === "COMPLETED" || ack.status === "FAILED") update.completed_at = now;
        await admin()
          .from("agnes_device_commands")
          .update(update)
          .eq("id", ack.id)
          .eq("device_id", auth.deviceId)
          .eq("user_id", auth.userId);
      }
    }

    if (notificationsRead.length > 0) {
      await admin()
        .from("agnes_notifications")
        .update({ read_at: now })
        .eq("user_id", auth.userId)
        .in("id", notificationsRead)
        .is("read_at", null);
    }

    const settings = await readSettings(auth.userId);

    const { data: commandRows } = await admin()
      .from("agnes_device_commands")
      .select("id, type, payload, status, expires_at, created_at")
      .eq("device_id", auth.deviceId)
      .eq("user_id", auth.userId)
      .in("status", ["PENDING", "RECEIVED", "EXECUTING"])
      .gt("expires_at", now)
      .order("created_at", { ascending: true })
      .limit(8);

    if (commandRows && commandRows.length > 0) {
      const pendingIds = commandRows.filter((row) => row.status === "PENDING").map((row) => row.id);
      if (pendingIds.length > 0) {
        await admin()
          .from("agnes_device_commands")
          .update({ status: "RECEIVED", received_at: now })
          .in("id", pendingIds)
          .eq("device_id", auth.deviceId);
      }
    }

    const [{ data: pet }, { data: notes }, { data: memories }, { data: achievementRows }] =
      await Promise.all([
        admin().from("agnes_pet_state").select("*").eq("user_id", auth.userId).maybeSingle(),
        admin()
          .from("agnes_notes")
          .select("id, title, body, pinned, version, updated_at")
          .eq("user_id", auth.userId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(20),
        settings?.cloud_memory_enabled
          ? admin()
            .from("agnes_memories")
            .select("id, category, content, pinned, updated_at")
            .eq("user_id", auth.userId)
            .eq("status", "approved")
            .is("deleted_at", null)
            .order("pinned", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(12)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        admin()
          .from("agnes_pet_achievements")
          .select("achievement_id, unlocked_at")
          .eq("user_id", auth.userId),
      ]);

    const notificationsEnabled = settings?.notifications_enabled !== false;
    const { data: notifications } = notificationsEnabled
      ? await admin()
        .from("agnes_notifications")
        .select("id, title, body, kind, created_at")
        .eq("user_id", auth.userId)
        .is("read_at", null)
        .is("deleted_at", null)
        .lte("deliver_at", now)
        .or(`device_id.is.null,device_id.eq.${auth.deviceId}`)
        .order("deliver_at", { ascending: true })
        .limit(5)
      : { data: [] };

    const { data: conversation } = await admin()
      .from("agnes_conversations")
      .select("id, title, last_message_at")
      .eq("user_id", auth.userId)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let pendingQuestion: Record<string, unknown> | null = null;
    if (conversation) {
      const { data: question } = await admin()
        .from("agnes_pending_questions")
        .select("id, question, expires_at")
        .eq("conversation_id", conversation.id)
        .eq("user_id", auth.userId)
        .eq("status", "pending")
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (question) {
        const questionBody = question.question as Record<string, unknown>;
        pendingQuestion = {
          id: question.id,
          ...questionBody,
          expires_at: question.expires_at,
        };
      }
    }

    await admin().from("agnes_sync_state").upsert({
      device_id: auth.deviceId,
      user_id: auth.userId,
      last_pull_at: now,
      last_push_at: now,
      cursor: Date.now(),
      updated_at: now,
    }, { onConflict: "device_id" });

    return ok(req, {
      server_time: now,
      settings,
      settings_version: settings?.sync_version ?? 0,
      pet_state: pet,
      pet_rejections: petRejections,
      achievements: [...achievements],
      // Hard-capped to the firmware buffers (CloudNote.body 400,
      // CloudMemory.content 240) so the device never has to discard a valid
      // sync response because of size.
      notes: (notes ?? []).map((note) => ({
        ...note,
        title: String(note.title ?? "").slice(0, 48),
        body: String(note.body ?? "").slice(0, 400),
      })),
      memories: (memories ?? []).map((memory) => ({
        ...memory,
        content: String(memory.content ?? "").slice(0, 240),
      })),
      notifications: notifications ?? [],
      commands: commandRows ?? [],
      commands_expired: [],
      conversation,
      pending_question: pendingQuestion,
      device: {
        id: auth.deviceId,
        name: auth.deviceName,
        hardware_id: auth.hardwareId,
      },
    });
  } catch (error) {
    return fail(req, error);
  }
});
