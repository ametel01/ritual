import type { WorkflowCandidate } from "../prompts/types.js";
import type { SkillEcosystem, SkillScope } from "./paths.js";

export const GENERATION_TEMPLATE_VERSION = "ritual-skill-template-v1";

export function buildGenerationPrompt(options: {
  candidate: WorkflowCandidate;
  skillName: string;
  scope: SkillScope;
  ecosystems: SkillEcosystem[];
}): string {
  const examples = options.candidate.representativePrompts
    .map((prompt, index) => `${index + 1}. ${prompt.text}`)
    .join("\n");

  return `Template version: ${GENERATION_TEMPLATE_VERSION}

Create exactly one reusable agent skill as a single SKILL.md file.

Skill name: ${options.skillName}
Scope: ${options.scope}
Target ecosystems: ${options.ecosystems.join(", ")}
Ranking rationale: ${options.candidate.rankReason}

Representative repeated prompts:
${examples}

Requirements:
- Return only the contents of SKILL.md.
- Use YAML frontmatter containing only name and description.
- name must be lowercase hyphen-case and equal "${options.skillName}".
- description must be trigger-rich and explain when to use the skill.
- The Markdown body must be concise, actionable instructions.
- Use imperative or infinitive instruction style.
- Do not create README.md, changelog, installation guide, or ecosystem metadata.
- Include scripts, references, or assets only if the workflow clearly needs them.
- Avoid leaking private history details beyond generalized workflow instructions.
`;
}

export function buildGenerationHandoffPrompt(
  options: {
    candidate: WorkflowCandidate;
    skillName: string;
    scope: SkillScope;
    ecosystems: SkillEcosystem[];
  },
  draftPath: string,
): string {
  const prompt = buildGenerationPrompt(options)
    .replace(
      "Create exactly one reusable agent skill as a single SKILL.md file.",
      `Create exactly one reusable agent skill and write it to this file:\n${draftPath}`,
    )
    .replace(
      "- Return only the contents of SKILL.md.",
      `- Write only the contents of SKILL.md to ${draftPath}.`,
    );

  return `${prompt}
Additional handoff instructions:
- Write the complete SKILL.md contents directly to ${draftPath}.
- Create the parent directory if it does not exist.
- Do not print the skill instead of writing the file.
- After writing the file, briefly summarize what you wrote and return control to the terminal.
`;
}
