// Presentation-safe codes. Runtime validation stays in server-side types.ts.
export const successKinds=["ONBOARDING","SUPPORT","INACTIVITY","RENEWAL","CHURN","WINBACK"] as const;
export const successStatuses=["OPEN","IN_PROGRESS","WAITING_REVIEW","COMPLETED","DISMISSED"] as const;
