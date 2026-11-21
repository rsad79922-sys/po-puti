package ru.poputi.app;
import static org.junit.Assert.*;
import org.junit.Test;

public class UpdatePolicyTest {
 private final String cert=new String(new char[64]).replace('\0','a'),digest=new String(new char[64]).replace('\0','b');
 private boolean available(long installed,String signer,String pkg,long code,String url){return PoPutiUpdatePolicy.available(installed,signer,pkg,code,"1.3.0",cert,digest,100,url);}
 @Test public void onlyNewerSameIdentityReleasesAreOffered(){
  assertTrue(available(9,cert,"ru.poputi.app",10,"https://vputipoputka.ru/downloads/po-puti-10.apk"));
  assertFalse(available(10,cert,"ru.poputi.app",10,"https://vputipoputka.ru/downloads/po-puti-10.apk"));
  assertFalse(available(11,cert,"ru.poputi.app",10,"https://vputipoputka.ru/downloads/po-puti-10.apk"));
  assertFalse(available(9,digest,"ru.poputi.app",10,"https://vputipoputka.ru/downloads/po-puti-10.apk"));
  assertFalse(available(9,cert,"other.app",10,"https://vputipoputka.ru/downloads/po-puti-10.apk"));
 }
 @Test public void unsafeDownloadDestinationsAreNeverOpened(){
  for(String url:new String[]{"http://vputipoputka.ru/downloads/po-puti-10.apk","https://evil.invalid/downloads/po-puti-10.apk","https://vputipoputka.ru.evil.invalid/downloads/po-puti-10.apk","https://user:password@vputipoputka.ru/downloads/po-puti-10.apk","https://vputipoputka.ru/downloads/po-puti-10.apk?redirect=evil","https://vputipoputka.ru/downloads/po-puti-9.apk","javascript:alert(1)",null})assertFalse(available(9,cert,"ru.poputi.app",10,url));
  assertFalse(PoPutiUpdatePolicy.valid("ru.poputi.app",10,"<script>",cert,digest,100,"https://vputipoputka.ru/downloads/po-puti-10.apk"));
  assertFalse(PoPutiUpdatePolicy.valid("ru.poputi.app",10,"1.3.0",cert,digest,0,"https://vputipoputka.ru/downloads/po-puti-10.apk"));
 }
}
