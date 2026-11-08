-- Atomic finalization of one conversation turn.
-- Inserts the user/assistant messages, resolves the pending question, creates
-- the next question, updates the conversation and records usage in a single
-- transaction. Called only by Edge Functions with the service role.

create unique index if not exists agnes_messages_request_role_idx
  on public.agnes_messages (user_id, (metadata->>'request_id'), role)
  where metadata ? 'request_id' and role in ('user','assistant');

create or replace function public.agnes_finalize_chat(
  p_user_id uuid,
  p_conversation_id uuid,
  p_user_content text,
  p_user_source text,
  p_user_metadata jsonb,
  p_assistant_content text,
  p_assistant_metadata jsonb,
  p_provider text,
  p_model text,
  p_emotion text,
  p_animation text,
  p_intensity integer,
  p_mood_delta integer,
  p_question jsonb,
  p_question_expires timestamptz,
  p_answered_question_id uuid,
  p_selected_option_id text,
  p_request_id text,
  p_usage jsonb,
  p_conversation_title text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_assistant_id uuid;
  v_question_id uuid;
  v_created_at timestamptz;
  v_reused boolean := false;
begin
  if p_user_id is null or p_conversation_id is null or p_request_id is null then
    raise exception 'missing required arguments' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.agnes_conversations
    where id = p_conversation_id and user_id = p_user_id and deleted_at is null
  ) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;

  -- Crash recovery: if the assistant row already exists for this request,
  -- return it instead of creating duplicates.
  select id, created_at into v_assistant_id, v_created_at
  from public.agnes_messages
  where user_id = p_user_id
    and role = 'assistant'
    and metadata->>'request_id' = p_request_id
  limit 1;

  if v_assistant_id is not null then
    select (metadata->>'question_id')::uuid into v_question_id
    from public.agnes_messages
    where id = v_assistant_id;
    return jsonb_build_object(
      'user_message_id', null,
      'assistant_message_id', v_assistant_id,
      'question_id', v_question_id,
      'created_at', v_created_at,
      'reused', true
    );
  end if;

  if p_user_content is not null then
    select id into v_user_id
    from public.agnes_messages
    where user_id = p_user_id
      and role = 'user'
      and metadata->>'request_id' = p_request_id
    limit 1;

    if v_user_id is null then
      insert into public.agnes_messages (
        conversation_id, user_id, role, content, input_source, selected_option_id, metadata
      ) values (
        p_conversation_id, p_user_id, 'user', left(p_user_content, 4000), p_user_source,
        p_selected_option_id, coalesce(p_user_metadata, '{}'::jsonb) || jsonb_build_object('request_id', p_request_id)
      )
      returning id into v_user_id;
    end if;
  end if;

  insert into public.agnes_messages (
    conversation_id, user_id, role, content, input_source, provider, model,
    emotion, animation, intensity, mood_delta, selected_option_id, metadata
  ) values (
    p_conversation_id, p_user_id, 'assistant', left(p_assistant_content, 4000), p_user_source,
    p_provider, p_model, p_emotion, p_animation, p_intensity, p_mood_delta, p_selected_option_id,
    coalesce(p_assistant_metadata, '{}'::jsonb) || jsonb_build_object('request_id', p_request_id)
  )
  returning id, created_at into v_assistant_id, v_created_at;

  if p_answered_question_id is not null then
    update public.agnes_pending_questions
    set status = 'answered', answer_option_id = p_selected_option_id, answered_at = now()
    where id = p_answered_question_id
      and user_id = p_user_id
      and conversation_id = p_conversation_id
      and status = 'pending';
  end if;

  update public.agnes_pending_questions
  set status = 'cancelled'
  where conversation_id = p_conversation_id
    and user_id = p_user_id
    and status = 'pending'
    and (p_answered_question_id is null or id <> p_answered_question_id);

  if p_question is not null then
    insert into public.agnes_pending_questions (
      user_id, conversation_id, device_id, question, status, expires_at
    ) values (
      p_user_id, p_conversation_id,
      (select device_id from public.agnes_conversations where id = p_conversation_id),
      p_question, 'pending', coalesce(p_question_expires, now() + interval '30 minutes')
    )
    returning id into v_question_id;

    update public.agnes_messages
    set metadata = metadata || jsonb_build_object('question_id', v_question_id)
    where id = v_assistant_id;
  end if;

  update public.agnes_conversations
  set last_message_at = now(),
      title = case
        when p_conversation_title is not null and length(trim(p_conversation_title)) > 0 then left(p_conversation_title, 120)
        else title
      end
  where id = p_conversation_id and user_id = p_user_id;

  if p_usage is not null then
    insert into public.agnes_ai_usage (
      user_id, message_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd
    ) values (
      p_user_id, v_assistant_id, p_provider, p_model,
      case when jsonb_typeof(p_usage->'promptTokens') = 'number' then (p_usage->>'promptTokens')::integer else null end,
      case when jsonb_typeof(p_usage->'completionTokens') = 'number' then (p_usage->>'completionTokens')::integer else null end,
      case when jsonb_typeof(p_usage->'totalTokens') = 'number' then (p_usage->>'totalTokens')::integer else null end,
      case when jsonb_typeof(p_usage->'costUsd') = 'number' then (p_usage->>'costUsd')::numeric(12,8) else null end
    );
  end if;

  return jsonb_build_object(
    'user_message_id', v_user_id,
    'assistant_message_id', v_assistant_id,
    'question_id', v_question_id,
    'created_at', v_created_at,
    'reused', v_reused
  );
end;
$$;

revoke all on function public.agnes_finalize_chat(
  uuid, uuid, text, text, jsonb, text, jsonb, text, text, text, text, integer, integer,
  jsonb, timestamptz, uuid, text, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.agnes_finalize_chat(
  uuid, uuid, text, text, jsonb, text, jsonb, text, text, text, text, integer, integer,
  jsonb, timestamptz, uuid, text, text, jsonb, text
) to service_role;
