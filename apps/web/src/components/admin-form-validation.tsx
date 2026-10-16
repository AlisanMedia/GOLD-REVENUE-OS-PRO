"use client";
import { useEffect,useRef } from "react";
import { useAdminI18n } from "./admin-i18n";
// Native controls retain browser accessibility, while validation follows the account locale.
export function AdminFormValidation({children}:{children:React.ReactNode}) {
 const {locale,t}=useAdminI18n(),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{for(const input of root.current?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')??[])input.setCustomValidity("");},[locale]);
 return <div ref={root} onInputCapture={event=>{const target=event.target;if(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)target.setCustomValidity("");}} onInvalidCapture={event=>{const target=event.target;if(!(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement))return;const v=target.validity;target.setCustomValidity(v.valueMissing?t("Please complete this field."):v.tooShort?t("This value is too short."):v.tooLong?t("This value is too long."):v.rangeOverflow||v.rangeUnderflow?t("Check the allowed range."):v.stepMismatch?t("Check the required numeric step."):t("Enter a valid value in the required format."));}}>{children}</div>;
}
