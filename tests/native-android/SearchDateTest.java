package ru.poputi.app;
import static org.junit.Assert.*;
import org.junit.Test;
import java.time.LocalDate;

public class SearchDateTest {
 @Test public void nextOccurrenceRetainsTodayAndHandlesNewYear(){
  assertEquals(LocalDate.of(2026,11,19),PoPutiSearchDate.next(LocalDate.of(2026,11,19),11,19));
  assertEquals(LocalDate.of(2027,1,2),PoPutiSearchDate.next(LocalDate.of(2026,12,31),1,2));
  assertEquals(LocalDate.of(2027,11,18),PoPutiSearchDate.next(LocalDate.of(2026,11,19),11,18));
 }
 @Test public void shortMonthsAndLeapYearsAreValid(){
  assertEquals(LocalDate.of(2027,2,28),PoPutiSearchDate.next(LocalDate.of(2026,11,19),2,31));
  assertEquals(LocalDate.of(2028,2,29),PoPutiSearchDate.next(LocalDate.of(2027,11,19),2,29));
  assertEquals(LocalDate.of(2026,4,30),PoPutiSearchDate.next(LocalDate.of(2026,1,1),4,31));
 }
 @Test public void displayHasNoYearOrHyphens(){assertEquals("20 ноября",PoPutiSearchDate.label(LocalDate.of(2026,11,20)));assertEquals("10 мая",PoPutiSearchDate.label(LocalDate.of(2030,5,10)));}
}
