#include "Chat.h"
#include "Util.h"
#include <string.h>

namespace {
constexpr const char* kContinuationMessage =
  "Please continue and give me exactly three short choices.";
}

bool Chat::begin(Cloud& cloud, Storage& storage, MoodEngine& mood) {
  cloud_ = &cloud;
  storage_ = &storage;
  mood_ = &mood;
  if (storage.loadChat(reply_)) {
    replyValid_ = true;
    optionsVisible_ = reply_.hasQuestion && !reply_.reply[0];
    selected_ = 0;
  }
  state_ = replyValid_ ? ChatState::Ready : ChatState::Empty;
  return true;
}

void Chat::updateConnectivity(bool online, bool paired) {
  online_ = online;
  paired_ = paired;
}

void Chat::open() {
  if (!cloud_) return;
  if (loading()) return;

  if (paired_ && online_) {
    bool queued = replyValid_ && reply_.conversationId[0] ? sendResume() : sendStart();
    if (queued) {
      state_ = ChatState::Loading;
      errorText_[0] = '\0';
    }
    return;
  }

  if (!paired_) {
    if (replyValid_) {
      setOffline("Pair this device from the dashboard to use cloud chat. Showing the last cached reply.");
    } else {
      setError("This device is not paired. Open Wi-Fi Setup, enter a pairing code from the dashboard, and restart.");
    }
    return;
  }

  if (replyValid_) {
    setOffline("Cloud AI needs Wi-Fi. Showing the last cached reply; no new reply can be generated offline.");
  } else {
    setOffline("Cloud AI needs Wi-Fi and this device is offline. No reply can be generated on the device.");
  }
}

void Chat::newConversation() {
  if (!paired_) {
    setError("Pair this device before starting a conversation.");
    return;
  }
  if (!online_) {
    setOffline("Cloud AI needs Wi-Fi. A new conversation cannot be generated offline.");
    return;
  }
  reply_ = ChatReply();
  replyValid_ = false;
  optionsVisible_ = false;
  fromSync_ = false;
  selected_ = 0;
  replyPage_ = 0;
  autoRecovered_ = false;
  lastAction_ = CloudJobType::None;
  if (storage_) storage_->clearChat();
  if (sendStart()) {
    state_ = ChatState::Loading;
    errorText_[0] = '\0';
  }
}

void Chat::retry() {
  if (!paired_) {
    setError("Pair this device before chatting.");
    return;
  }
  if (!online_) {
    setOffline("Cloud AI is unavailable offline. Connect Wi-Fi and try again.");
    return;
  }

  bool queued = false;
  switch (lastAction_) {
    case CloudJobType::ChatStart:
      queued = sendStart();
      break;
    case CloudJobType::ChatResume:
      queued = sendResume();
      break;
    case CloudJobType::ChatSelect:
      if (hasQuestion()) {
        queued = sendSelect();
      } else {
        queued = sendMessage();
      }
      break;
    case CloudJobType::ChatMessage:
      queued = sendMessage();
      break;
    default:
      open();
      return;
  }
  if (queued) {
    state_ = ChatState::Loading;
    errorText_[0] = '\0';
  }
}

void Chat::selectDelta(int8_t delta) {
  if (!hasQuestion() || reply_.optionCount != 3) return;
  int next = (int)selected_ + delta;
  if (next < 0) next = 2;
  if (next > 2) next = 0;
  selected_ = (uint8_t)next;
}

void Chat::confirm() {
  if (loading()) return;

  // Opening the choice list is safe offline because it only reveals options
  // that were already generated and cached.
  if (hasQuestion() && !optionsVisible_) {
    optionsVisible_ = true;
    return;
  }

  if (!paired_) {
    setError("Pair this device from the dashboard before chatting.");
    return;
  }
  if (!online_) {
    setOffline("Cloud AI needs Wi-Fi. This device cannot generate a reply offline.");
    return;
  }

  if (hasQuestion()) {
    uint32_t now = AgnesUtil::nowEpoch();
    if (reply_.questionExpiresEpoch > 0 && now > 0 &&
        now > reply_.questionExpiresEpoch) {
      clearQuestion();
      if (storage_) storage_->saveChat(reply_);
      sendContinuation();
      return;
    }
    submitSelection();
    return;
  }

  sendContinuation();
}

void Chat::showOptions() {
  if (hasQuestion()) optionsVisible_ = true;
}

void Chat::showReply() {
  optionsVisible_ = false;
}

void Chat::onReply(const ChatReply& reply) {
  if ((reply.hasQuestion && reply.optionCount != 3) ||
      (!reply.reply[0] && !reply.hasQuestion)) {
    setError("The AI reply did not contain usable text or exactly three choices.");
    return;
  }

  reply_ = reply;
  replyValid_ = true;
  fromSync_ = false;
  optionsVisible_ = reply.hasQuestion && !reply.reply[0];
  selected_ = 0;
  replyPage_ = 0;
  replyVersion_++;
  autoRecovered_ = false;
  errorText_[0] = '\0';
  state_ = ChatState::Ready;

  if (mood_) {
    Emotion emotion = emotionFromString(reply.emotion);
    mood_->set(emotion, reply.intensity, true);
    mood_->applyDelta(reply.moodDelta);
  }
  if (storage_) storage_->saveChat(reply_);
}

void Chat::onError(const CloudError& error) {
  const char* message = error.message[0] ? error.message : "The request failed.";

  if (error.code == CloudErrorCode::Offline || error.code == CloudErrorCode::NotConfigured) {
    setOffline(message);
    return;
  }

  if (lastAction_ == CloudJobType::ChatResume && !autoRecovered_ &&
      (strstr(message, "No conversation") != nullptr ||
       strstr(message, "Conversation not found") != nullptr)) {
    autoRecovered_ = true;
    reply_.conversationId[0] = '\0';
    if (sendStart()) {
      state_ = ChatState::Loading;
      errorText_[0] = '\0';
      return;
    }
  }

  if (lastAction_ == CloudJobType::ChatSelect &&
      (strstr(message, "expired") != nullptr || strstr(message, "already been answered") != nullptr)) {
    clearQuestion();
    if (storage_) storage_->saveChat(reply_);
    setError("That choice expired or was answered elsewhere. Press SEL to ask AGNES to continue.");
    return;
  }

  if (error.code == CloudErrorCode::Unauthorized || error.code == CloudErrorCode::Revoked) {
    setError("This device is no longer authorized. Re-pair it from the dashboard.");
    return;
  }

  setError(message);
}

void Chat::adoptPendingQuestion(const CloudSyncResult& sync) {
  if (replyValid_ || loading()) return;
  if (!sync.valid || !sync.hasPendingQuestion || sync.questionOptionCount != 3) return;

  reply_ = ChatReply();
  AgnesUtil::copyString(reply_.conversationId, sizeof(reply_.conversationId),
                        sync.conversationId);
  AgnesUtil::copyString(reply_.questionId, sizeof(reply_.questionId), sync.questionId);
  AgnesUtil::copyString(reply_.question, sizeof(reply_.question), sync.questionText);
  for (uint8_t i = 0; i < 3; ++i) reply_.options[i] = sync.questionOptions[i];
  reply_.optionCount = 3;
  reply_.hasQuestion = true;
  AgnesUtil::copyString(reply_.emotion, sizeof(reply_.emotion), "normal");
  AgnesUtil::copyString(reply_.animation, sizeof(reply_.animation), "none");
  reply_.intensity = 1;
  replyValid_ = true;
  fromSync_ = true;
  optionsVisible_ = true;
  selected_ = 0;
  replyPage_ = 0;
  replyVersion_++;
  state_ = ChatState::Ready;
  errorText_[0] = '\0';
  if (storage_) storage_->saveChat(reply_);
}

void Chat::clearLocal() {
  reply_ = ChatReply();
  replyValid_ = false;
  optionsVisible_ = false;
  fromSync_ = false;
  selected_ = 0;
  replyPage_ = 0;
  replyVersion_++;
  state_ = ChatState::Empty;
  errorText_[0] = '\0';
  lastAction_ = CloudJobType::None;
  if (storage_) storage_->clearChat();
}

void Chat::setError(const char* message) {
  AgnesUtil::asciiCopy(errorText_, sizeof(errorText_), message);
  state_ = ChatState::Error;
}

void Chat::setOffline(const char* message) {
  AgnesUtil::asciiCopy(errorText_, sizeof(errorText_), message);
  state_ = ChatState::Offline;
}

void Chat::clearQuestion() {
  reply_.hasQuestion = false;
  reply_.questionId[0] = '\0';
  reply_.question[0] = '\0';
  reply_.questionExpiresEpoch = 0;
  reply_.optionCount = 0;
  optionsVisible_ = false;
  selected_ = 0;
}

bool Chat::sendStart() {
  if (!cloud_) return false;
  rememberAction(CloudJobType::ChatStart);
  return cloud_->enqueueChat(CloudJobType::ChatStart, nullptr, nullptr, nullptr, nullptr);
}

bool Chat::sendResume() {
  if (!cloud_ || !reply_.conversationId[0]) return false;
  rememberAction(CloudJobType::ChatResume);
  return cloud_->enqueueChat(CloudJobType::ChatResume, reply_.conversationId,
                             nullptr, nullptr, nullptr);
}

bool Chat::sendSelect() {
  if (!cloud_ || !hasQuestion() || reply_.optionCount != 3) return false;
  AgnesUtil::copyString(lastQuestionId_, sizeof(lastQuestionId_), reply_.questionId);
  AgnesUtil::copyString(lastOptionId_, sizeof(lastOptionId_), reply_.options[selected_].id);
  rememberAction(CloudJobType::ChatSelect);
  return cloud_->enqueueChat(CloudJobType::ChatSelect, reply_.conversationId,
                             lastQuestionId_, lastOptionId_, nullptr);
}

bool Chat::sendMessage() {
  if (!cloud_) return false;
  AgnesUtil::copyString(lastMessage_, sizeof(lastMessage_), kContinuationMessage);
  rememberAction(CloudJobType::ChatMessage);
  return cloud_->enqueueChat(CloudJobType::ChatMessage, reply_.conversationId,
                             nullptr, nullptr, lastMessage_);
}

void Chat::submitSelection() {
  if (!sendSelect()) {
    setError("The network queue is full. Wait a moment and press SEL to retry.");
    return;
  }
  state_ = ChatState::Loading;
  errorText_[0] = '\0';
}

void Chat::sendContinuation() {
  if (!sendMessage()) {
    setError("The network queue is full. Wait a moment and press SEL to retry.");
    return;
  }
  state_ = ChatState::Loading;
  errorText_[0] = '\0';
}

void Chat::rememberAction(CloudJobType action) {
  lastAction_ = action;
}
