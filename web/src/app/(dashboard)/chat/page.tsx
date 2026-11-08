import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ChatClient } from "@/components/chat-client";
import type {
  Conversation,
  Device,
  Message,
  PendingQuestion,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversation" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const [conversationsResult, devicesResult] = await Promise.all([
    supabase
      .from("agnes_conversations")
      .select("id, title, device_id, archived, last_message_at, created_at")
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .limit(60),
    supabase
      .from("agnes_devices")
      .select("id, name")
      .is("revoked_at", null),
  ]);

  const conversations = (conversationsResult.data ?? []) as Conversation[];
  const devices = (devicesResult.data ?? []) as Device[];

  const requested = params.c ? conversations.find((conversation) => conversation.id === params.c) : null;
  const active = requested ?? conversations[0] ?? null;

  let messages: Message[] = [];
  let pending: PendingQuestion | null = null;

  if (active) {
    const [messagesResult, pendingResult] = await Promise.all([
      supabase
        .from("agnes_messages")
        .select(
          "id, conversation_id, role, content, input_source, provider, model, emotion, animation, intensity, selected_option_id, metadata, created_at",
        )
        .eq("conversation_id", active.id)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("agnes_pending_questions")
        .select("id, conversation_id, question, status, expires_at, created_at")
        .eq("conversation_id", active.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    messages = (messagesResult.data ?? []) as Message[];
    pending = (pendingResult.data ?? null) as PendingQuestion | null;
  }

  return (
    <ChatClient
      initialConversations={conversations}
      initialActiveId={active?.id ?? null}
      initialMessages={messages}
      initialPending={pending}
      devices={devices.map((device) => ({ id: device.id, name: device.name }))}
      signedInEmail={user.email ?? ""}
    />
  );
}
