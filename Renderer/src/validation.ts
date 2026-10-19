import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import gardenStateSchema from "../../Shared/GardenState.schema.json";
import type { GardenSnapshotEnvelope, GardenState } from "./types";

const maximumMessageBytes = 64 * 1_024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
});
ajv.addFormat("uuid", (value: string) => uuidPattern.test(value));

const validateStateSchema = ajv.compile(gardenStateSchema) as ValidateFunction<GardenState>;

export class GardenContractError extends Error {
  public constructor(
    message: string,
    public readonly errors: ErrorObject[] = [],
  ) {
    super(message);
    this.name = "GardenContractError";
  }
}

export function validateGardenState(value: unknown): GardenState {
  if (!validateStateSchema(value)) {
    throw new GardenContractError("GardenState failed schema validation.", [
      ...(validateStateSchema.errors ?? []),
    ]);
  }
  return value;
}

export function decodeSnapshotEnvelope(input: string | unknown): GardenSnapshotEnvelope {
  const encoded = typeof input === "string" ? input : JSON.stringify(input);
  if (new TextEncoder().encode(encoded).byteLength > maximumMessageBytes) {
    throw new GardenContractError("Bridge message exceeds the 64 KiB contract limit.");
  }

  let value: unknown;
  try {
    value = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new GardenContractError("Bridge message is not valid JSON.");
  }

  if (!isRecord(value)) {
    throw new GardenContractError("Bridge message must be an object.");
  }
  if (value.type !== "state-snapshot" || value.schemaVersion !== 1) {
    throw new GardenContractError("Bridge message type or schema version is unsupported.");
  }
  if (typeof value.requestID !== "string" || !uuidPattern.test(value.requestID)) {
    throw new GardenContractError("Bridge request identifier is invalid.");
  }
  if (!isRecord(value.payload)) {
    throw new GardenContractError("Bridge payload must be an object.");
  }

  const state = validateGardenState(value.payload.state);
  return {
    type: "state-snapshot",
    schemaVersion: 1,
    requestID: value.requestID,
    payload: { state },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
