import {
  CallToolRequestSchema,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";

interface RawToolCall {
  arguments: Record<string, unknown>;
  name: string;
}

interface ToolRequestContext {
  requestId: RequestId;
}

const rawToolCalls = new Map<RequestId, RawToolCall>();

export function recordRawToolArguments(message: unknown): void {
  if (!isJSONRPCRequest(message)) {
    return;
  }

  const parsed = CallToolRequestSchema.safeParse(message);
  if (!parsed.success) {
    return;
  }

  rawToolCalls.set(message.id, {
    arguments: parsed.data.params.arguments ?? {},
    name: parsed.data.params.name,
  });
}

export function releaseRawToolArguments(message: unknown): void {
  if (
    (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) &&
    message.id !== undefined
  ) {
    rawToolCalls.delete(message.id);
  }
}

export function assertNoUnknownToolArguments(
  toolName: string,
  shapeKeys: readonly string[],
  extra: ToolRequestContext | undefined,
): void {
  if (!extra) {
    return;
  }

  const rawToolCall = rawToolCalls.get(extra.requestId);
  rawToolCalls.delete(extra.requestId);

  if (!rawToolCall || rawToolCall.name !== toolName) {
    return;
  }

  const unknownArgumentNames = Object.keys(rawToolCall.arguments).filter(
    (argumentName) => !shapeKeys.includes(argumentName),
  );
  if (unknownArgumentNames.length === 0) {
    return;
  }

  const unknownArguments = unknownArgumentNames.join("、");
  const hasScreenshotSource = ["screenshot", "screenshot_url", "capture_device"].some(
    (argumentName) => Object.hasOwn(rawToolCall.arguments, argumentName),
  );
  if (
    toolName === "compare_design" &&
    unknownArgumentNames.includes("screenshot_path") &&
    !hasScreenshotSource
  ) {
    throw new Error(
      `screenshot が指定されていません。${unknownArguments} という引数は受け取っていません。画像のパスは screenshot に渡してください。`,
    );
  }

  throw new Error(
    `${unknownArguments} という引数は受け取っていません。${toolName} で使用できる引数: ${shapeKeys.join(", ")}。`,
  );
}
