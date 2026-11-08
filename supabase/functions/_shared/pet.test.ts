import { assertEquals } from "jsr:@std/assert@1";
import { levelForXp, stageForLevel } from "./pet.ts";

Deno.test("pet level grows with XP and stages follow levels", () => {
  assertEquals(levelForXp(0), 1);
  assertEquals(levelForXp(39), 1);
  assertEquals(levelForXp(40), 2);
  assertEquals(levelForXp(1000), 6);
  assertEquals(stageForLevel(1), "newborn");
  assertEquals(stageForLevel(5), "curious");
  assertEquals(stageForLevel(15), "companion");
  assertEquals(stageForLevel(30), "guardian");
});
