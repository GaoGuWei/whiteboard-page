import { roles } from "./roles.mjs";
import { commonRules } from "./commonRules.mjs";
import { taskRules } from "./taskRules.mjs";
import { topicRules } from "./topicRules.mjs";

export const mathSkill = {
  id: "math",
  label: "数学老师",
  roles,
  commonRules,
  taskRules,
  topicRules,
};
