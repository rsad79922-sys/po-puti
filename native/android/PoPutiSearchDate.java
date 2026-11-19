package ru.poputi.app;

import java.time.LocalDate;
import java.time.YearMonth;

/** A day/month choice means its next occurrence, with the year retained in the API. */
public final class PoPutiSearchDate {
 private PoPutiSearchDate() {}
 public static LocalDate next(LocalDate today,int month,int day) {
  if(month<1||month>12||day<1||day>31)throw new IllegalArgumentException("Invalid day or month");
  int year=today.getYear();
  LocalDate candidate=LocalDate.of(year,month,Math.min(day,YearMonth.of(year,month).lengthOfMonth()));
  if(candidate.isBefore(today)){year++;candidate=LocalDate.of(year,month,Math.min(day,YearMonth.of(year,month).lengthOfMonth()));}
  return candidate;
 }
 private static final String[] MONTHS={"января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"};
 public static String label(LocalDate date){return date.getDayOfMonth()+" "+MONTHS[date.getMonthValue()-1];}
}
