import type { ClassifiedQuery } from "./query-classifier";

export function generateSmartSuggestions(classified: ClassifiedQuery): string[] {
  const suggestions: string[] = [];

  if (classified.intentMode === "directory_smb" && !classified.location) {
    suggestions.push(
      `${classified.icpNoun || classified.coreSkill + " agencies"} in India`,
      `${classified.icpNoun || classified.coreSkill + " agencies"} in United States`,
      `${classified.coreSkill} agencies in London`,
    );
    return [...new Set(suggestions)].slice(0, 5);
  }

  if (classified.signalMode === "buying_signal") {
    suggestions.push(
      "Currently hiring 3+ engineers with experience in Next.js",
      "Faced cybersecurity attacks or data breach in the last 12 months",
      "The company is SOC 2 Type 2 compliant",
      "Onboarded Data Engineer in the last 3 months",
    );
    return [...new Set(suggestions)].slice(0, 5);
  }

  if (classified.relatedSkills.length > 0) {
    suggestions.push(...classified.relatedSkills.slice(0, 3));
  }

  if (classified.coreSkill.includes(" ")) {
    suggestions.push(classified.coreSkill.split(" ")[0]);
  }

  if (classified.roleTitle.toLowerCase() !== classified.raw.toLowerCase()) {
    suggestions.push(classified.roleTitle);
  }

  if (classified.type === "product" && classified.relatedSkills.length === 0) {
    suggestions.push(classified.coreSkill.replace(/\b(app|tool|software|platform)\b/gi, "").trim());
  }

  return [...new Set(suggestions.map((s) => s.trim()).filter((s) => s.length > 1))].slice(0, 5);
}
