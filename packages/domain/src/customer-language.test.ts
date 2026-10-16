import { describe,it,expect } from "vitest";
import { inferStyleProfile } from "./conversation-quality";
describe("verified customer language is independent from administrator locale",()=>{
 it("defaults to professional English without a customer preference",()=>expect(inferStyleProfile([{direction:"inbound",content:"Could you help with my membership?"}]).language).toBe("en"));
 it.each(["en","tr","ar","ru"])("honors source-bound verified %s preference",language=>expect(inferStyleProfile([{direction:"inbound",content:"Hello"}],language).language).toBe(language));
 it("lets the customer's explicit current request override the saved preference",()=>expect(inferStyleProfile([{direction:"inbound",content:"Please reply in English"}],"tr").language).toBe("en"));
 it.each([["Türkçe yanıtla","tr"],["İngilizce cevap ver","en"],["أجب بالعربية","ar"],["Отвечай по-русски","ru"]])("honors explicit multilingual request %s over a saved preference",(content,expected)=>expect(inferStyleProfile([{direction:"inbound",content}],expected==="en"?"tr":"en").language).toBe(expected));
 it("does not accept administrator locales as customer preferences",()=>expect(inferStyleProfile([{direction:"inbound",content:"Hello"}],"tr-TR").language).toBe("en"));
 it("preserves language inference without a verified preference",()=>{expect(inferStyleProfile([{direction:"inbound",content:"Merhaba, fiyat nedir?"}]).language).toBe("tr");expect(inferStyleProfile([{direction:"inbound",content:"مرحباً"}]).language).toBe("ar");expect(inferStyleProfile([{direction:"inbound",content:"Здравствуйте"}]).language).toBe("ru");});
});
