import { IDENTITY_NAMES_V1 } from "@gold-revenue-os/contracts";

/** A complete old signed header pair may cross the ingress cutover. Mixed
 * namespaces are never accepted; all body, timing and HMAC checks still apply. */
export function jeffTransportHeaders(headers: Headers, kind: "uat" | "stars") {
  const suffix = kind === "uat" ? "uat" : "stars-uat";
  const current = { timestamp: "x-jeff-" + suffix + "-timestamp", signature: "x-jeff-" + suffix + "-signature" };
  const previous = kind === "uat" ? { timestamp: IDENTITY_NAMES_V1.uatTimestamp, signature: IDENTITY_NAMES_V1.uatSignature }
    : { timestamp: IDENTITY_NAMES_V1.starsTimestamp, signature: IDENTITY_NAMES_V1.starsSignature };
  const hasCurrent = headers.has(current.timestamp) || headers.has(current.signature);
  const hasPrevious = headers.has(previous.timestamp) || headers.has(previous.signature);
  if (hasCurrent && hasPrevious) throw Error("JEFF_TRANSPORT_NAMESPACE_CONFLICT");
  const selected = hasCurrent ? current : previous;
  return { timestamp: headers.get(selected.timestamp) ?? "", signature: headers.get(selected.signature) };
}
