package ru.poputi.app;

/** Distribution identity is independent of accounts, push providers and stores. */
public final class PoPutiUpdatePolicy {
 public static final String ORIGIN="https://vputipoputka.ru";
 public static boolean valid(String pkg,long code,String name,String cert,String digest,long bytes,String url){
  return "ru.poputi.app".equals(pkg)&&code>=4&&code<=999999999L&&name!=null&&name.matches("[0-9]+(?:\\.[0-9]+){1,3}")&&cert!=null&&cert.matches("[a-f0-9]{64}")&&digest!=null&&digest.matches("[a-f0-9]{64}")&&bytes>0&&bytes<=200*1024*1024L&&(ORIGIN+"/downloads/po-puti-"+code+".apk").equals(url);
 }
 public static boolean available(long installed,String installedCert,String pkg,long code,String name,String cert,String digest,long bytes,String url){
  return code>installed&&installedCert!=null&&installedCert.equals(cert)&&valid(pkg,code,name,cert,digest,bytes,url);
 }
 private PoPutiUpdatePolicy(){}
}
