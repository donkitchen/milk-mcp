/**
 * milk-schema Tag Validation
 *
 * Validates tags against the milk-schema specification.
 * See: https://milk.tools/milk-schema
 */

// Valid values for each tag prefix
const SCHEMA: Record<string, string[] | "any"> = {
  "s:": ["inbox", "todo", "active", "blocked", "review", "done", "cancelled", "someday"],
  "p:": ["1", "2", "3", "4"],
  "type:": ["feature", "bug", "chore", "spike", "debt", "docs", "design", "decision"],
  "size:": ["xs", "s", "m", "l", "xl"],
  "impact:": ["high", "medium", "low"],
  "energy:": ["deep", "shallow", "social"],
  "area:": "any", // Custom area tags are allowed
  "sprint:": "any", // Format: YYYY-Www
  "@": "any", // Assignee tags
};

export interface TagValidationResult {
  valid: boolean;
  tag: string;
  message?: string;
  suggestion?: string;
}

/**
 * Validate a single tag against milk-schema.
 */
export function validateTag(tag: string): TagValidationResult {
  // Assignee tags: @name
  if (tag.startsWith("@")) {
    return { valid: true, tag };
  }

  // Find matching prefix
  for (const [prefix, values] of Object.entries(SCHEMA)) {
    if (prefix === "@") continue; // Handled above

    if (tag.startsWith(prefix)) {
      const value = tag.slice(prefix.length);

      // "any" means any value is valid
      if (values === "any") {
        return { valid: true, tag };
      }

      // Check if value is in the allowed list
      if (values.includes(value)) {
        return { valid: true, tag };
      }

      // Invalid value for known prefix
      return {
        valid: false,
        tag,
        message: `Invalid value "${value}" for ${prefix} tag`,
        suggestion: `Valid values: ${values.join(", ")}`,
      };
    }
  }

  // Unknown prefix — warn but don't reject
  return {
    valid: true, // Allow custom tags
    tag,
    message: `Unknown tag prefix: ${tag}`,
  };
}

/**
 * Validate multiple tags and return results.
 */
export function validateTags(tags: string[]): {
  valid: TagValidationResult[];
  invalid: TagValidationResult[];
  warnings: TagValidationResult[];
} {
  const valid: TagValidationResult[] = [];
  const invalid: TagValidationResult[] = [];
  const warnings: TagValidationResult[] = [];

  for (const tag of tags) {
    const result = validateTag(tag);
    if (!result.valid) {
      invalid.push(result);
    } else if (result.message) {
      warnings.push(result);
    } else {
      valid.push(result);
    }
  }

  return { valid, invalid, warnings };
}

/**
 * Format validation results as a human-readable message.
 */
export function formatValidationResults(
  results: ReturnType<typeof validateTags>,
  mode: "warn" | "enforce" | "off"
): string | null {
  if (mode === "off") return null;

  const messages: string[] = [];

  if (results.invalid.length > 0) {
    for (const r of results.invalid) {
      messages.push(`❌ ${r.tag}: ${r.message}${r.suggestion ? ` (${r.suggestion})` : ""}`);
    }
  }

  if (mode === "warn" && results.warnings.length > 0) {
    for (const r of results.warnings) {
      messages.push(`⚠️ ${r.tag}: ${r.message}`);
    }
  }

  return messages.length > 0 ? messages.join("\n") : null;
}
