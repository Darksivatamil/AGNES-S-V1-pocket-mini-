#pragma once
#include <Arduino.h>
#include "Cloud.h"
#include "Storage.h"
#include "MoodEngine.h"

enum class ChatState : uint8_t {
  Empty = 0,
  Loading,
  Ready,
  Offline,
  Error,
};

// Device-side conversation controller.
//
// The device never composes free text. It has exactly three AI-generated
// choices, and when there is no pending question the only user action is the
// explicit canned continuation ("Ask AGNES to continue") which is not one of
// the three options. Cloud AI requires Wi-Fi; no reply is ever simulated.
class Chat {
 public:
  bool begin(Cloud& cloud, Storage& storage, MoodEngine& mood);

  void updateConnectivity(bool online, bool paired);
  void open();
  void newConversation();
  void retry();

  // Moves the choice highlight; ignored without a valid question.
  void selectDelta(int8_t delta);
  // In the reply view, opens the choice view when a question exists.
  // In the choice view, submits the selected option.
  // Without a question, sends the explicit canned continuation.
  void confirm();
  void showOptions();
  void showReply();
  void setReplyPage(uint8_t page) { replyPage_ = page; }

  void onReply(const ChatReply& reply);
  void onError(const CloudError& error);
  void adoptPendingQuestion(const CloudSyncResult& sync);
  void clearLocal();

  bool hasReply() const { return replyValid_; }
  bool hasQuestion() const { return replyValid_ && reply_.hasQuestion; }
  bool loading() const { return state_ == ChatState::Loading; }
  bool online() const { return online_; }
  bool paired() const { return paired_; }
  ChatState state() const { return state_; }
  bool optionsVisible() const { return optionsVisible_; }
  bool fromSync() const { return fromSync_; }
  uint8_t selectedOption() const { return selected_; }
  uint8_t replyPage() const { return replyPage_; }
  uint32_t replyVersion() const { return replyVersion_; }
  const ChatReply& reply() const { return reply_; }
  const char* errorText() const { return errorText_; }

 private:
  Cloud* cloud_ = nullptr;
  Storage* storage_ = nullptr;
  MoodEngine* mood_ = nullptr;

  ChatState state_ = ChatState::Empty;
  ChatReply reply_;
  bool replyValid_ = false;
  bool fromSync_ = false;
  bool optionsVisible_ = false;
  bool online_ = false;
  bool paired_ = false;
  bool autoRecovered_ = false;
  uint8_t selected_ = 0;
  uint8_t replyPage_ = 0;
  uint32_t replyVersion_ = 0;
  char errorText_[112] = {0};

  CloudJobType lastAction_ = CloudJobType::None;
  char lastQuestionId_[40] = {0};
  char lastOptionId_[40] = {0};
  char lastMessage_[160] = {0};

  void setError(const char* message);
  void setOffline(const char* message);
  void clearQuestion();
  bool sendStart();
  bool sendResume();
  bool sendSelect();
  bool sendMessage();
  void submitSelection();
  void sendContinuation();
  void rememberAction(CloudJobType action);
};
