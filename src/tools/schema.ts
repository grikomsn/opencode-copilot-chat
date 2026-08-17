export function sanitizeToolSchema(schema: unknown): Record<string, unknown> {
  const root = record(schema) ?? { type: "object", properties: {} };
  const value = sanitizeNode(root, root, new Set(), new WeakSet());
  const result = record(value);
  if (!result) return { type: "object", properties: {} };
  return {
    type: "object",
    properties: record(result.properties) ?? {},
    ...(Array.isArray(result.required) ? { required: result.required } : {}),
    ...(Array.isArray(result.enum) ? { enum: result.enum } : {}),
  };
}

function sanitizeNode(value: unknown, root: Record<string, unknown>, refs: Set<string>, visiting: WeakSet<object>): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeNode(item, root, refs, visiting));
  const source = record(value);
  if (!source) return value;
  if (visiting.has(source)) return {};
  visiting.add(source);
  try {
    const ref = typeof source.$ref === "string" ? source.$ref : undefined;
    if (ref?.startsWith("#/") && !refs.has(ref)) {
      const target = resolvePointer(root, ref);
      if (target !== undefined) {
        const nextRefs = new Set(refs).add(ref);
        const siblings = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "$ref"));
        const resolved = sanitizeNode(target, root, nextRefs, visiting);
        return sanitizeNode({ ...(record(resolved) ?? {}), ...siblings }, root, nextRefs, visiting);
      }
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (["$schema", "$id", "$ref", "$defs", "definitions"].includes(key)) continue;
      if (key === "properties" && record(child)) {
        result.properties = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, item]) => [name, sanitizeNode(item, root, refs, visiting)]));
      } else if (["items", "additionalProperties"].includes(key)) {
        result[key] = sanitizeNode(child, root, refs, visiting);
      } else if (["anyOf", "oneOf", "allOf"].includes(key) && Array.isArray(child)) {
        result[key] = child.map((item) => sanitizeNode(item, root, refs, visiting));
      } else if (["type", "description", "enum", "const", "pattern", "format", "default", "required", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].includes(key)) {
        result[key] = child;
      }
    }
    return result;
  } finally {
    visiting.delete(source);
  }
}

function resolvePointer(root: Record<string, unknown>, pointer: string): unknown {
  return pointer.slice(2).split("/").reduce<unknown>((current, segment) => record(current)?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], root);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
