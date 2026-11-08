#include "PetEngine.h"
#include "Util.h"
#include <math.h>
#include <string.h>

void PetEngine::begin(Storage& storage) {
  storage_ = &storage;
  if (!storage.loadPet(pet_)) {
    pet_ = PetState();
    AgnesUtil::copyString(pet_.name, sizeof(pet_.name), "Agnes");
    pet_.lastDecayEpoch = AgnesUtil::nowEpoch();
  }
  queueCount_ = storage.loadPetEvents(queue_, AGNES_OFFLINE_QUEUE_MAX);
}

void PetEngine::adopt(const PetState& state) {
  if (!state.name[0]) return;
  pet_ = state;
  if (pet_.level < 1) pet_.level = 1;
  if (pet_.happiness > 100) pet_.happiness = 100;
  if (pet_.energy > 100) pet_.energy = 100;
  if (pet_.hunger > 100) pet_.hunger = 100;
  save();
}

void PetEngine::save() {
  if (storage_) storage_->savePet(pet_);
}

int PetEngine::typeIndex(const char* type) {
  if (!type) return -1;
  if (strcmp(type, "feed") == 0) return 0;
  if (strcmp(type, "play") == 0) return 1;
  if (strcmp(type, "rest") == 0) return 2;
  if (strcmp(type, "pet") == 0) return 3;
  return -1;
}

uint32_t PetEngine::cooldownMs(const char* type) {
  int index = typeIndex(type);
  switch (index) {
    case 0: return 300000UL;
    case 1: return 180000UL;
    case 2: return 600000UL;
    case 3: return 60000UL;
    default: return 0;
  }
}

uint32_t PetEngine::levelForXp(uint32_t xp) {
  uint32_t level = (uint32_t)sqrtf((float)xp / 40.0f) + 1;
  if (level < 1) level = 1;
  if (level > 999) level = 999;
  return level;
}

const char* PetEngine::stageForLevel(uint8_t level) {
  if (level < 5) return "newborn";
  if (level < 15) return "curious";
  if (level < 30) return "companion";
  return "guardian";
}

bool PetEngine::canInteract(const char* type, uint16_t* remainingSeconds) const {
  int index = typeIndex(type);
  if (index < 0) {
    if (remainingSeconds) *remainingSeconds = 0;
    return false;
  }
  uint32_t now = millis();
  if ((int32_t)(cooldownUntilMs_[index] - now) > 0) {
    if (remainingSeconds) {
      *remainingSeconds = (uint16_t)((cooldownUntilMs_[index] - now + 999) / 1000);
    }
    return false;
  }
  if (remainingSeconds) *remainingSeconds = 0;
  return true;
}

void PetEngine::enqueue(const char* id, const char* type) {
  if (queueCount_ >= AGNES_OFFLINE_QUEUE_MAX) return;
  AgnesUtil::copyString(queue_[queueCount_].id, sizeof(queue_[queueCount_].id), id);
  AgnesUtil::copyString(queue_[queueCount_].type, sizeof(queue_[queueCount_].type), type);
  queueCount_++;
  if (storage_) storage_->savePetEvents(queue_, queueCount_);
}

bool PetEngine::interact(const char* type, char* eventIdOut, size_t capacity, uint32_t nowEpoch) {
  int index = typeIndex(type);
  if (index < 0) return false;
  if (queueCount_ >= AGNES_OFFLINE_QUEUE_MAX) return false;
  if (!canInteract(type, nullptr)) return false;

  int happiness = pet_.happiness;
  int energy = pet_.energy;
  int hunger = pet_.hunger;
  int xp = pet_.friendshipXp;

  switch (index) {
    case 0:  // feed
      happiness += 3; energy += 1; hunger -= 18; xp += 5; break;
    case 1:  // play
      happiness += 8; energy -= 7; hunger += 5; xp += 10; break;
    case 2:  // rest
      happiness += 2; energy += 15; xp += 4; break;
    case 3:  // pet
      happiness += 5; xp += 3; break;
  }

  pet_.happiness = (uint8_t)AgnesUtil::clampInt(happiness, 0, 100);
  pet_.energy = (uint8_t)AgnesUtil::clampInt(energy, 0, 100);
  pet_.hunger = (uint8_t)AgnesUtil::clampInt(hunger, 0, 100);
  pet_.friendshipXp = (uint16_t)AgnesUtil::clampInt(xp, 0, 65535);
  pet_.level = (uint8_t)levelForXp(pet_.friendshipXp);
  AgnesUtil::copyString(pet_.stage, sizeof(pet_.stage), stageForLevel(pet_.level));
  if (nowEpoch > 0) pet_.lastDecayEpoch = nowEpoch;

  char id[40];
  AgnesUtil::uuidV4(id, sizeof(id));
  if (eventIdOut && capacity > 0) AgnesUtil::copyString(eventIdOut, capacity, id);
  enqueue(id, type);
  cooldownUntilMs_[index] = millis() + cooldownMs(type);
  save();
  return true;
}

void PetEngine::decay(uint32_t nowEpoch) {
  if (nowEpoch < 1700000000UL || pet_.lastDecayEpoch < 1700000000UL) return;
  uint32_t elapsed = nowEpoch - pet_.lastDecayEpoch;
  if (elapsed < 900UL) return;
  float hours = (float)elapsed / 3600.0f;
  if (hours > 168.0f) hours = 168.0f;

  float hunger = pet_.hunger + hours * 2.2f;
  float energy = pet_.energy - hours * 1.0f;
  float happiness = pet_.happiness - (pet_.hunger > 70 ? hours * 1.2f : hours * 0.25f);
  pet_.hunger = (uint8_t)AgnesUtil::clampFloat(hunger, 0, 100);
  pet_.energy = (uint8_t)AgnesUtil::clampFloat(energy, 0, 100);
  pet_.happiness = (uint8_t)AgnesUtil::clampFloat(happiness, 0, 100);
  pet_.lastDecayEpoch = nowEpoch;

  if (millis() - lastDecaySaveMs_ > 3600000UL) {
    lastDecaySaveMs_ = millis();
    save();
  }
}

uint8_t PetEngine::pendingEvents(PendingPetEvent* out, uint8_t maxCount) const {
  if (!out) return 0;
  uint8_t count = queueCount_ < maxCount ? queueCount_ : maxCount;
  for (uint8_t i = 0; i < count; ++i) out[i] = queue_[i];
  return count;
}

void PetEngine::clearPendingEvents(uint8_t sentCount) {
  if (sentCount > queueCount_) sentCount = queueCount_;
  if (sentCount == 0) return;
  uint8_t remaining = queueCount_ - sentCount;
  for (uint8_t i = 0; i < remaining; ++i) queue_[i] = queue_[i + sentCount];
  queueCount_ = remaining;
  if (storage_) storage_->savePetEvents(queue_, queueCount_);
}
