// Activity Heart Rate Replay for Arduino Uno + HM-10 BLE Module
//
// Streams real heart rate data from a recorded activity session (68 min, 1192
// samples, 84-190 bpm) over BLE as "exercise.hr" JSON metric lines.
//
// Compatible with the "Arduino + HM-10" device profile in the MSML app.
//
// Wiring:
//   HM-10 TX -> Arduino pin 7  (SoftwareSerial RX)
//   HM-10 RX -> Arduino pin 8  (SoftwareSerial TX)
//   HM-10 VCC -> 3.3V or 5V, GND -> GND
//
// In the mobile app: select "Arduino + HM-10" profile.
// The ExerciseScreen will show live HR from exercise.hr metric.
//
// Playback control (edit these constants):
//   PLAYBACK_SPEED_X  - integer speed multiplier (1=real-time, 4=4x faster)
//   MAX_GAP_MS        - maximum inter-sample wait before speed is applied
//                       (prevents long pauses from the original recording gaps)

#include <EEPROM.h>
#include <SoftwareSerial.h>
#include <avr/pgmspace.h>
#include <avr/wdt.h>
#include <stdlib.h>
#include <string.h>

// -----------------------------------------------------------------------
// Playback tuning
// -----------------------------------------------------------------------
static const uint8_t  PLAYBACK_SPEED_X = 4;        // 4x faster than real time
static const uint32_t MAX_GAP_MS       = 8000UL;   // cap gaps (before speed divisor)

// -----------------------------------------------------------------------
// HM-10 / SoftwareSerial pins and baud
// -----------------------------------------------------------------------
static const uint8_t  BT_RX_PIN  = 7;
static const uint8_t  BT_TX_PIN  = 8;
static const uint32_t HM10_DEFAULT_UART_BAUD = 9600UL;
static const uint32_t HM10_MAX_SAFE_SOFTWARESERIAL_BAUD = 38400UL;
static const bool HM10_BLIND_NORMALIZE_TO_PREFERRED_BAUD_ON_BOOT = true;
static const bool HM10_PROBE_BAUD_ON_BOOT   = true;
static const bool HM10_APPLY_BOOT_PROFILE   = true;
static const uint16_t HM10_BAUD_APPLY_DELAY_MS = 1800U;
static const uint8_t  HM10_BAUD_PREF_EEPROM_SIGNATURE    = 0xB5;
static const uint8_t  HM10_BAUD_PREF_EEPROM_SIGNATURE_V1 = 0xB4;

SoftwareSerial BT(BT_RX_PIN, BT_TX_PIN);
#define DBG Serial

// -----------------------------------------------------------------------
// Metric names
// -----------------------------------------------------------------------
static const char METRIC_EXERCISE_HR[]    = "exercise.hr";
static const char METRIC_TIME_MS[]        = "sensor.time_ms";
static const char METRIC_HM10_LINK_PROBE[]= "sensor.hm10_link_probe";
static const char METRIC_HM10_LINK_ACK[]  = "sensor.hm10_link_ack";

// -----------------------------------------------------------------------
// PROGMEM data arrays  (1192 samples, ~3.5 KB flash)
// -----------------------------------------------------------------------
// HR_SAMPLE_COUNT = 1192
// HR range: 84-190 bpm
// Time range: 0-4106 s
#define HR_SAMPLE_COUNT 1192U

static const uint16_t HR_TIME_S[HR_SAMPLE_COUNT] PROGMEM = {
      0,     9,    10,    14,    16,    19,    21,    22,    25,    27,    28,    29,
     31,    32,    34,    35,    40,    42,    44,    46,    47,    49,    50,    54,
     57,    60,    61,    62,    67,    68,    69,   309,   314,   315,   316,   317,
    318,   319,   321,   322,   323,   324,   325,   327,   330,   331,   335,   336,
    341,   342,   343,   344,   347,   349,   350,   351,   354,   355,   357,   358,
    359,   361,   363,   364,   365,   367,   368,   369,   372,   374,   376,   377,
    381,   384,   385,   390,   391,   392,   394,   397,   400,   401,   403,   404,
    405,   406,   411,   417,   420,   422,   426,   428,   429,   432,   434,   437,
    438,   440,   442,   448,   449,   450,   451,   455,   460,   462,   464,   466,
    468,   469,   472,   473,   474,   480,   482,   483,   488,   491,   492,   493,
    496,   497,   498,   499,   502,   505,   506,   511,   515,   518,   519,   520,
    522,   525,   526,   529,   531,   532,   539,   540,   542,   544,   549,   550,
    554,   555,   557,   559,   561,   563,   568,   572,   573,   577,   581,   587,
    588,   590,   593,   596,   598,   601,   604,   609,   611,   614,   618,   620,
    624,   626,   629,   631,   637,   638,   644,   648,   650,   651,   656,   657,
    664,   666,   671,   673,   675,   677,   679,   680,   683,   686,   690,   691,
    695,   700,   706,   707,   711,   712,   713,   714,   717,   721,   722,   727,
    728,   729,   735,   736,   738,   741,   742,   743,   745,   747,   749,   751,
    752,   755,   756,   760,   762,   763,   764,   766,   768,   770,   772,   773,
    775,   778,   779,   781,   782,   788,   789,   795,   797,   801,   804,   810,
    811,   814,   819,   826,   831,   832,   836,   837,   838,   841,   845,   848,
    852,   854,   858,   862,   866,   867,   869,   873,   876,   878,   879,   880,
    882,   885,   886,   887,   891,   893,   894,   895,   896,   900,   905,   910,
    911,   916,   918,   924,   926,   928,   933,   934,   940,   946,   952,   955,
    961,   963,   970,   972,   976,   979,   984,   985,   990,   994,   997,   999,
   1001,  1007,  1015,  1022,  1027,  1029,  1034,  1041,  1043,  1047,  1048,  1051,
   1056,  1057,  1059,  1061,  1062,  1064,  1065,  1066,  1068,  1074,  1076,  1078,
   1082,  1083,  1088,  1090,  1092,  1093,  1097,  1103,  1109,  1110,  1112,  1113,
   1115,  1120,  1124,  1126,  1132,  1136,  1141,  1143,  1145,  1151,  1156,  1161,
   1164,  1167,  1170,  1171,  1175,  1179,  1186,  1187,  1193,  1199,  1200,  1201,
   1204,  1208,  1212,  1218,  1221,  1224,  1230,  1232,  1237,  1238,  1241,  1242,
   1243,  1249,  1256,  1257,  1264,  1270,  1276,  1281,  1282,  1284,  1287,  1289,
   1292,  1294,  1300,  1307,  1309,  1314,  1316,  1318,  1322,  1329,  1330,  1336,
   1339,  1344,  1345,  1349,  1355,  1357,  1359,  1363,  1365,  1371,  1378,  1379,
   1385,  1388,  1392,  1394,  1400,  1406,  1408,  1413,  1416,  1423,  1425,  1432,
   1438,  1445,  1446,  1453,  1457,  1461,  1466,  1469,  1471,  1472,  1474,  1476,
   1480,  1482,  1483,  1490,  1495,  1497,  1498,  1499,  1500,  1503,  1504,  1508,
   1510,  1514,  1515,  1517,  1520,  1522,  1525,  1528,  1534,  1535,  1542,  1543,
   1549,  1552,  1553,  1559,  1565,  1567,  1571,  1572,  1577,  1583,  1590,  1591,
   1593,  1597,  1603,  1604,  1610,  1613,  1618,  1621,  1627,  1629,  1636,  1637,
   1643,  1644,  1649,  1650,  1654,  1655,  1658,  1660,  1666,  1672,  1675,  1676,
   1678,  1679,  1685,  1686,  1688,  1691,  1695,  1700,  1702,  1707,  1712,  1714,
   1718,  1725,  1726,  1730,  1731,  1734,  1739,  1741,  1744,  1750,  1757,  1763,
   1768,  1773,  1779,  1785,  1786,  1792,  1797,  1799,  1807,  1813,  1814,  1815,
   1818,  1824,  1831,  1833,  1838,  1844,  1845,  1852,  1855,  1861,  1867,  1872,
   1873,  1881,  1887,  1893,  1899,  1900,  1906,  1909,  1915,  1916,  1923,  1924,
   1925,  1931,  1935,  1937,  1939,  1943,  1950,  1953,  1955,  1956,  1959,  1962,
   1963,  1967,  1971,  1972,  1977,  1979,  1980,  1983,  1989,  1990,  1995,  2003,
   2007,  2008,  2011,  2014,  2019,  2021,  2029,  2034,  2036,  2039,  2040,  2042,
   2044,  2045,  2046,  2049,  2053,  2055,  2061,  2063,  2066,  2069,  2074,  2077,
   2079,  2084,  2085,  2089,  2095,  2101,  2102,  2109,  2116,  2117,  2122,  2127,
   2134,  2142,  2149,  2150,  2152,  2153,  2159,  2164,  2169,  2171,  2173,  2174,
   2179,  2184,  2188,  2191,  2192,  2195,  2196,  2200,  2206,  2212,  2213,  2218,
   2224,  2228,  2231,  2234,  2237,  2238,  2239,  2241,  2246,  2250,  2254,  2256,
   2262,  2263,  2269,  2271,  2276,  2277,  2283,  2284,  2292,  2293,  2298,  2299,
   2300,  2306,  2310,  2311,  2313,  2318,  2319,  2322,  2326,  2332,  2334,  2340,
   2347,  2348,  2354,  2361,  2362,  2368,  2370,  2376,  2377,  2384,  2389,  2394,
   2400,  2407,  2411,  2415,  2420,  2422,  2424,  2430,  2437,  2439,  2446,  2448,
   2456,  2462,  2464,  2467,  2471,  2476,  2478,  2481,  2485,  2491,  2497,  2498,
   2502,  2503,  2505,  2510,  2513,  2514,  2519,  2524,  2525,  2531,  2536,  2538,
   2544,  2547,  2549,  2555,  2563,  2564,  2566,  2570,  2571,  2573,  2574,  2575,
   2577,  2579,  2580,  2581,  2584,  2585,  2587,  2590,  2592,  2595,  2599,  2600,
   2606,  2614,  2621,  2628,  2629,  2631,  2633,  2635,  2638,  2641,  2644,  2650,
   2651,  2656,  2658,  2661,  2662,  2664,  2669,  2670,  2675,  2676,  2677,  2682,
   2688,  2692,  2694,  2697,  2702,  2707,  2710,  2711,  2714,  2716,  2717,  2722,
   2723,  2725,  2726,  2731,  2737,  2739,  2743,  2747,  2749,  2751,  2752,  2756,
   2758,  2761,  2767,  2773,  2774,  2779,  2780,  2783,  2784,  2790,  2791,  2793,
   2799,  2800,  2806,  2811,  2816,  2819,  2821,  2822,  2827,  2830,  2831,  2835,
   2836,  2842,  2844,  2850,  2851,  2854,  2856,  2860,  2862,  2869,  2870,  2877,
   2883,  2886,  2893,  2896,  2902,  2909,  2915,  2916,  2920,  2922,  2926,  2928,
   2933,  2934,  2940,  2941,  2947,  2953,  2956,  2963,  2964,  2970,  2977,  2983,
   2988,  2994,  2995,  3001,  3007,  3009,  3014,  3021,  3027,  3029,  3035,  3040,
   3047,  3048,  3053,  3058,  3059,  3064,  3065,  3069,  3071,  3073,  3079,  3081,
   3085,  3088,  3094,  3096,  3098,  3103,  3109,  3110,  3114,  3119,  3123,  3127,
   3130,  3131,  3133,  3135,  3137,  3138,  3141,  3142,  3148,  3151,  3155,  3161,
   3163,  3164,  3168,  3172,  3174,  3179,  3184,  3186,  3189,  3192,  3195,  3200,
   3203,  3206,  3210,  3212,  3213,  3215,  3216,  3217,  3220,  3223,  3227,  3233,
   3235,  3240,  3244,  3250,  3257,  3258,  3265,  3267,  3268,  3274,  3277,  3278,
   3284,  3286,  3291,  3296,  3297,  3304,  3309,  3310,  3313,  3314,  3315,  3316,
   3317,  3319,  3320,  3325,  3327,  3330,  3336,  3337,  3341,  3346,  3347,  3354,
   3357,  3364,  3366,  3373,  3376,  3379,  3385,  3391,  3398,  3399,  3406,  3407,
   3414,  3417,  3418,  3422,  3424,  3429,  3435,  3436,  3439,  3443,  3444,  3448,
   3450,  3456,  3457,  3462,  3465,  3466,  3467,  3468,  3469,  3470,  3472,  3474,
   3475,  3485,  3492,  3496,  3497,  3499,  3501,  3507,  3514,  3521,  3523,  3526,
   3528,  3534,  3539,  3546,  3548,  3554,  3560,  3566,  3567,  3568,  3573,  3579,
   3581,  3586,  3588,  3591,  3598,  3602,  3608,  3609,  3610,  3614,  3620,  3621,
   3622,  3625,  3629,  3637,  3638,  3645,  3649,  3650,  3651,  3655,  3660,  3661,
   3663,  3665,  3667,  3672,  3675,  3678,  3684,  3686,  3687,  3689,  3694,  3699,
   3700,  3701,  3703,  3706,  3707,  3711,  3712,  3713,  3714,  3715,  3720,  3723,
   3725,  3727,  3728,  3729,  3735,  3737,  3741,  3747,  3748,  3753,  3754,  3760,
   3761,  3766,  3770,  3771,  3811,  3813,  3818,  3820,  3821,  3824,  3826,  3828,
   3831,  3832,  3837,  3838,  3840,  3843,  3844,  3845,  3847,  3850,  3851,  3854,
   3856,  3860,  3862,  3868,  3872,  3873,  3877,  3878,  3881,  3885,  3886,  3891,
   3898,  3900,  3901,  3904,  3905,  3908,  3913,  3919,  3920,  3924,  3925,  3932,
   3938,  3939,  3941,  3943,  3947,  3949,  3954,  3956,  3962,  3963,  3970,  3976,
   3978,  3979,  3985,  3987,  3990,  3993,  3997,  3998,  3999,  4004,  4010,  4011,
   4012,  4014,  4015,  4018,  4020,  4025,  4030,  4031,  4035,  4037,  4040,  4046,
   4050,  4051,  4055,  4057,  4059,  4060,  4062,  4065,  4066,  4068,  4074,  4077,
   4078,  4079,  4080,  4081,  4083,  4086,  4087,  4088,  4092,  4093,  4095,  4097,
   4098,  4101,  4104,  4106
};

static const uint8_t HR_BPM[HR_SAMPLE_COUNT] PROGMEM = {
   96, 100, 103, 106, 108, 112, 115, 114, 118, 117, 116, 116, 115, 115, 118, 119,
  122, 121, 123, 125, 123, 125, 126, 126, 127, 127, 127, 128, 128, 127, 128,  87,
   84,  90,  93,  96,  93,  97,  96,  97,  96,  95,  94,  97,  98,  98, 102, 102,
  104, 105, 107, 109, 111, 110, 111, 112, 112, 116, 118, 119, 119, 120, 120, 120,
  120, 121, 121, 121, 120, 121, 124, 123, 125, 128, 126, 126, 128, 130, 132, 133,
  134, 134, 131, 134, 134, 135, 136, 135, 132, 131, 130, 130, 133, 135, 136, 136,
  138, 137, 136, 138, 137, 139, 142, 142, 143, 142, 141, 141, 141, 140, 137, 140,
  140, 140, 140, 140, 140, 139, 139, 140, 140, 141, 140, 141, 141, 143, 144, 143,
  143, 147, 147, 148, 147, 148, 148, 150, 151, 152, 153, 152, 155, 156, 157, 160,
  161, 163, 166, 166, 165, 166, 167, 168, 168, 169, 170, 168, 169, 170, 169, 168,
  169, 167, 167, 164, 164, 164, 162, 163, 165, 165, 165, 164, 164, 164, 166, 169,
  167, 167, 164, 164, 163, 163, 162, 160, 159, 158, 158, 158, 158, 158, 157, 158,
  156, 154, 156, 157, 154, 154, 154, 153, 153, 154, 156, 156, 154, 156, 157, 157,
  159, 157, 158, 158, 155, 155, 156, 158, 156, 157, 157, 157, 157, 157, 157, 158,
  160, 160, 157, 158, 155, 158, 158, 158, 159, 161, 160, 162, 163, 163, 164, 165,
  165, 166, 164, 163, 162, 162, 159, 159, 158, 157, 156, 156, 156, 159, 156, 158,
  159, 159, 159, 160, 160, 161, 158, 161, 160, 163, 163, 163, 164, 165, 166, 163,
  163, 163, 164, 161, 161, 163, 165, 165, 163, 163, 162, 162, 161, 161, 158, 157,
  158, 157, 159, 158, 162, 166, 166, 166, 168, 165, 166, 166, 167, 170, 168, 169,
  169, 166, 167, 168, 169, 169, 168, 168, 166, 165, 162, 164, 164, 165, 166, 167,
  166, 165, 167, 166, 165, 163, 163, 161, 161, 158, 157, 157, 159, 159, 162, 161,
  164, 164, 162, 162, 161, 161, 161, 161, 161, 160, 161, 163, 166, 168, 171, 171,
  174, 177, 177, 177, 179, 176, 177, 178, 179, 182, 184, 183, 180, 182, 182, 181,
  182, 182, 179, 182, 182, 180, 179, 179, 179, 179, 179, 179, 179, 177, 178, 177,
  176, 176, 174, 174, 175, 177, 174, 175, 174, 174, 174, 176, 178, 180, 180, 182,
  179, 178, 177, 174, 173, 174, 172, 172, 172, 170, 168, 168, 167, 167, 169, 167,
  171, 173, 174, 175, 177, 177, 177, 177, 174, 176, 177, 177, 174, 177, 177, 177,
  181, 178, 178, 179, 179, 179, 177, 179, 177, 178, 178, 178, 178, 178, 178, 175,
  176, 177, 176, 176, 177, 177, 178, 178, 178, 178, 177, 179, 178, 176, 176, 176,
  175, 175, 175, 175, 175, 177, 175, 176, 174, 176, 174, 177, 177, 177, 177, 179,
  178, 178, 178, 177, 176, 178, 178, 178, 178, 177, 178, 180, 177, 178, 179, 179,
  180, 179, 178, 175, 177, 177, 177, 177, 178, 178, 178, 176, 179, 179, 176, 178,
  175, 176, 177, 177, 177, 176, 175, 177, 174, 174, 174, 174, 175, 176, 175, 176,
  174, 174, 177, 175, 176, 175, 175, 177, 177, 178, 180, 182, 182, 183, 181, 180,
  180, 179, 177, 177, 177, 177, 180, 180, 181, 184, 186, 187, 190, 189, 190, 190,
  190, 189, 187, 186, 183, 185, 184, 184, 183, 186, 183, 182, 179, 179, 177, 175,
  172, 170, 168, 167, 166, 166, 164, 161, 162, 162, 163, 163, 164, 164, 166, 165,
  162, 166, 167, 167, 164, 161, 164, 167, 167, 167, 167, 164, 165, 165, 165, 165,
  163, 163, 165, 167, 165, 166, 161, 167, 167, 169, 171, 171, 172, 168, 173, 173,
  171, 173, 173, 176, 175, 176, 172, 171, 171, 170, 169, 168, 168, 167, 167, 168,
  168, 168, 168, 169, 171, 174, 177, 177, 179, 179, 180, 181, 182, 182, 183, 182,
  183, 181, 178, 181, 180, 179, 176, 178, 175, 172, 172, 169, 168, 168, 168, 171,
  170, 169, 169, 172, 172, 173, 173, 176, 176, 174, 174, 174, 173, 173, 176, 177,
  173, 174, 174, 174, 173, 174, 173, 173, 174, 177, 177, 179, 179, 178, 178, 178,
  178, 178, 179, 177, 181, 178, 178, 175, 173, 175, 177, 181, 179, 180, 183, 183,
  182, 183, 183, 182, 181, 182, 181, 178, 178, 177, 177, 182, 180, 181, 178, 181,
  179, 180, 182, 183, 183, 183, 182, 182, 181, 181, 181, 183, 183, 183, 183, 182,
  183, 186, 182, 182, 181, 181, 181, 184, 180, 177, 178, 178, 179, 180, 180, 178,
  177, 175, 174, 174, 173, 173, 172, 169, 170, 170, 170, 171, 170, 172, 171, 172,
  171, 172, 175, 178, 179, 179, 179, 178, 178, 177, 179, 177, 177, 176, 176, 179,
  175, 174, 172, 172, 173, 174, 175, 177, 178, 175, 174, 178, 178, 175, 174, 173,
  173, 175, 173, 175, 173, 176, 173, 174, 174, 174, 174, 175, 175, 177, 177, 177,
  179, 178, 178, 177, 178, 176, 179, 179, 180, 181, 180, 181, 181, 178, 179, 178,
  177, 178, 177, 178, 179, 182, 183, 182, 182, 180, 181, 180, 179, 178, 179, 178,
  177, 179, 178, 179, 179, 176, 175, 171, 174, 174, 174, 175, 176, 176, 176, 176,
  176, 177, 176, 175, 175, 176, 173, 175, 176, 176, 177, 179, 179, 178, 179, 179,
  180, 180, 180, 178, 178, 179, 180, 183, 182, 182, 179, 178, 175, 176, 173, 170,
  167, 164, 163, 162, 162, 163, 163, 164, 165, 167, 168, 169, 170, 168, 167, 166,
  167, 167, 166, 165, 165, 164, 168, 165, 166, 169, 169, 171, 171, 173, 173, 173,
  171, 171, 174, 174, 174, 172, 175, 175, 175, 176, 177, 177, 176, 176, 176, 176,
  176, 177, 176, 175, 174, 174, 174, 176, 176, 176, 178, 178, 177, 174, 174, 171,
  170, 170, 171, 171, 173, 176, 176, 176, 177, 179, 178, 180, 180, 180, 183, 180,
  180, 180, 180, 180, 181, 180, 181, 180, 180, 180, 179, 179, 181, 181, 179, 180,
  180, 180, 179, 178, 178, 181, 182, 183, 180, 183, 182, 182, 182, 181, 181, 181,
  180, 180, 181, 181, 181, 182, 181, 180, 180, 181, 182, 182, 182, 181, 179, 182,
  182, 181, 181, 181, 181, 181, 180, 178, 179, 181, 179, 180, 179, 180, 179, 180,
  183, 179, 179, 179, 179, 178, 179, 178, 179, 179, 177, 179, 180, 180, 181, 180,
  179, 179, 178, 177, 177, 178, 179, 177, 176, 176, 177, 176, 168, 166, 164, 164,
  164, 162, 161, 160, 161, 162, 162, 162, 163, 166, 166, 164, 164, 167, 168, 170,
  171, 173, 173, 172, 174, 174, 174, 174, 174, 174, 174, 177, 176, 177, 177, 177,
  178, 179, 179, 179, 179, 182, 180, 182, 183, 183, 183, 183, 181, 179, 177, 177,
  176, 176, 175, 174, 172, 172, 175, 176, 177, 178, 178, 178, 178, 178, 176, 177,
  178, 175, 176, 175, 175, 177, 176, 175, 178, 178, 177, 177, 178, 178, 179, 178,
  177, 177, 177, 176, 176, 175, 175, 176, 176, 176, 176, 176, 176, 176, 176, 177,
  177, 177, 178, 179, 180, 181, 178, 180
};

// -----------------------------------------------------------------------
// Hardware / timing constants
// -----------------------------------------------------------------------
static const uint8_t  LED_PIN         = LED_BUILTIN;
static const uint8_t  LED_ACK_MS      = 8;
static const uint32_t AT_TIMEOUT_MS   = 1500UL;
static const uint32_t AT_CONFIG_TIMEOUT_MS = 900UL;
static const uint16_t INTER_METRIC_DELAY_MS = 60;
static const uint8_t  MAX_LINE_BYTES  = 96;
static const uint8_t  MAX_AT_REPLY_BYTES = 96;
static const uint8_t  MAX_COMMAND_BYTES  = 48;

static const uint32_t HM10_SUPPORTED_UART_BAUDS[] = {
  1200UL, 2400UL, 4800UL, 9600UL, 19200UL, 38400UL, 57600UL, 115200UL
};
static const uint8_t HM10_SUPPORTED_UART_BAUD_COUNT =
  sizeof(HM10_SUPPORTED_UART_BAUDS) / sizeof(HM10_SUPPORTED_UART_BAUDS[0]);

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------
static uint32_t frameCount  = 0;
static bool     hmOk        = false;
static uint32_t hmActiveBaud    = HM10_DEFAULT_UART_BAUD;
static uint32_t hmPreferredBaud = HM10_DEFAULT_UART_BAUD;
static uint32_t hmPendingBaud   = HM10_DEFAULT_UART_BAUD;
static uint32_t hmBaudApplyAtMs = 0;
static bool     hmHasPendingBaudApply = false;
static bool     hmNeedsBootNormalize  = false;
static char     hmCommandBuffer[MAX_COMMAND_BYTES + 1];
static uint8_t  hmCommandLength = 0;

// Playback state
static uint16_t hrIndex       = 0;      // current position in data arrays
static uint32_t playStartMs   = 0;      // millis() when replay began (or restarted)
static uint16_t firstTimeS    = 0;      // HR_TIME_S[0] of current loop

struct Hm10BaudPreference {
  uint8_t  signature;
  uint32_t baud;
  uint8_t  pendingNormalize;
};
struct Hm10BaudPreferenceV1 {
  uint8_t  signature;
  uint32_t baud;
};

// -----------------------------------------------------------------------
// Forward declarations
// -----------------------------------------------------------------------
static bool btSendUint32(const char *metric, uint32_t value);
static bool btSendValueText(const char *metric, const char *valueText);
static bool hmApplyPeripheralProfile(void);
static bool hmEnsurePreferredStreamingBaud(void);
static void hmBlindNormalizeToPreferredBaud(void);
static void hmLoadPreferredBaud(void);
static void hmStorePreferredBaud(uint32_t baud, bool pendingNormalize);
static void hmPollIncomingCommands(void);
static void hmMaybeApplyPendingBaud(void);

// -----------------------------------------------------------------------
// LED helpers
// -----------------------------------------------------------------------
static void ledBlink(uint8_t count, uint16_t onMs, uint16_t offMs) {
  for (uint8_t i = 0; i < count; i++) {
    digitalWrite(LED_PIN, HIGH); delay(onMs);
    digitalWrite(LED_PIN, LOW);  delay(offMs);
  }
}
static void ledAckSend() {
  digitalWrite(LED_PIN, HIGH); delay(LED_ACK_MS); digitalWrite(LED_PIN, LOW);
}

// -----------------------------------------------------------------------
// HM-10 baud helpers
// -----------------------------------------------------------------------
static bool hmIsSupportedBaud(uint32_t baud) {
  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++)
    if (HM10_SUPPORTED_UART_BAUDS[i] == baud) return true;
  return false;
}

static const char *hmBaudCommandFor(uint32_t baud) {
  switch (baud) {
    case 1200UL:   return "AT+BAUD7";
    case 2400UL:   return "AT+BAUD6";
    case 4800UL:   return "AT+BAUD5";
    case 9600UL:   return "AT+BAUD0";
    case 19200UL:  return "AT+BAUD1";
    case 38400UL:  return "AT+BAUD2";
    case 57600UL:  return "AT+BAUD3";
    case 115200UL: return "AT+BAUD4";
    default: return NULL;
  }
}

static void hmWarnIfBaudMayBeNoisy(uint32_t baud) {
  if (baud > HM10_MAX_SAFE_SOFTWARESERIAL_BAUD)
    DBG.println(F("[HM10] Warning: baud above Uno SoftwareSerial comfort range."));
}

static void hmDrainRx() { while (BT.available()) BT.read(); }

static bool hmReadReply(char *out, size_t outSize, uint32_t timeoutMs) {
  if (!out || outSize == 0) return false;
  out[0] = '\0';
  size_t len = 0; bool sawByte = false;
  uint32_t start = millis(), lastByteAt = start;
  while (millis() - start < timeoutMs) {
    while (BT.available()) {
      const char c = static_cast<char>(BT.read());
      sawByte = true; lastByteAt = millis();
      if (len + 1 < outSize) { out[len++] = c; out[len] = '\0'; }
    }
    if (sawByte && millis() - lastByteAt >= 40UL) break;
  }
  out[len] = '\0'; return sawByte;
}

static bool hmSendCommandExpect(const char *command, const char *expectedSubstring,
                                uint32_t timeoutMs) {
  char reply[MAX_AT_REPLY_BYTES + 1];
  hmDrainRx(); BT.print(command);
  const bool gotReply = hmReadReply(reply, sizeof(reply), timeoutMs);
  if (!gotReply) { DBG.print(F("[HM10] No reply for ")); DBG.println(command); return false; }
  DBG.print(F("[HM10] ")); DBG.print(command); DBG.print(F(" -> ")); DBG.println(reply);
  if (!expectedSubstring || expectedSubstring[0] == '\0') return true;
  return strstr(reply, expectedSubstring) != NULL;
}

static void hmLoadPreferredBaud() {
  Hm10BaudPreference pref = { 0, HM10_DEFAULT_UART_BAUD, 0 };
  EEPROM.get(0, pref);
  if (pref.signature == HM10_BAUD_PREF_EEPROM_SIGNATURE && hmIsSupportedBaud(pref.baud)) {
    hmPreferredBaud = pref.baud; hmNeedsBootNormalize = pref.pendingNormalize == 1; return;
  }
  Hm10BaudPreferenceV1 legacy = { 0, HM10_DEFAULT_UART_BAUD };
  EEPROM.get(0, legacy);
  if (legacy.signature == HM10_BAUD_PREF_EEPROM_SIGNATURE_V1 && hmIsSupportedBaud(legacy.baud)) {
    hmPreferredBaud = legacy.baud; hmNeedsBootNormalize = false;
    hmStorePreferredBaud(hmPreferredBaud, false); return;
  }
  hmPreferredBaud = HM10_DEFAULT_UART_BAUD; hmNeedsBootNormalize = false;
}

static void hmStorePreferredBaud(uint32_t baud, bool pendingNormalize) {
  if (!hmIsSupportedBaud(baud)) return;
  const Hm10BaudPreference pref = { HM10_BAUD_PREF_EEPROM_SIGNATURE, baud,
                                     pendingNormalize ? 1U : 0U };
  EEPROM.put(0, pref);
}

static bool hmApplyBaudChange(uint32_t targetBaud) {
  const char *cmd = hmBaudCommandFor(targetBaud);
  if (!cmd) return false;
  hmWarnIfBaudMayBeNoisy(targetBaud);
  if (hmActiveBaud == targetBaud) { BT.begin(hmActiveBaud); BT.listen(); delay(200); return true; }
  DBG.print(F("[HM10] Switching to ")); DBG.print(targetBaud); DBG.println(F(" baud..."));
  if (!hmSendCommandExpect(cmd, "OK", AT_CONFIG_TIMEOUT_MS)) return false;
  hmActiveBaud = targetBaud; BT.begin(hmActiveBaud); BT.listen(); delay(250);
  return hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS);
}

static void hmScheduleBaudApply(uint32_t targetBaud) {
  hmPendingBaud = targetBaud;
  hmBaudApplyAtMs = millis() + HM10_BAUD_APPLY_DELAY_MS;
  hmHasPendingBaudApply = true;
}

static void hmHandleCommandLine(const char *line) {
  if (!line || line[0] == '\0') return;
  if (strncmp(line, "HM10:PING=", 10) == 0) {
    char *end = NULL;
    const uint32_t token = static_cast<uint32_t>(strtoul(line + 10, &end, 10));
    if (end == line + 10 || (end && *end != '\0')) return;
    DBG.print(F("[HM10] PING ")); DBG.print(token); DBG.println(F(" -> ACK"));
    btSendUint32(METRIC_HM10_LINK_ACK, token); return;
  }
  if (strncmp(line, "HM10:BAUD=", 10) == 0) {
    char *end = NULL;
    const uint32_t requestedBaud = static_cast<uint32_t>(strtoul(line + 10, &end, 10));
    if (end == line + 10 || (end && *end != '\0') || !hmIsSupportedBaud(requestedBaud)) return;
    hmPreferredBaud = requestedBaud; hmNeedsBootNormalize = true;
    hmStorePreferredBaud(hmPreferredBaud, true);
    if (hmActiveBaud != hmPreferredBaud) hmScheduleBaudApply(hmPreferredBaud);
  }
}

static void hmPollIncomingCommands() {
  while (BT.available()) {
    const char c = static_cast<char>(BT.read());
    if (c == '\r' || c == '\n') {
      if (hmCommandLength == 0) continue;
      hmCommandBuffer[hmCommandLength] = '\0';
      hmHandleCommandLine(hmCommandBuffer);
      hmCommandLength = 0; hmCommandBuffer[0] = '\0'; continue;
    }
    if (hmCommandLength + 1 >= sizeof(hmCommandBuffer)) {
      hmCommandLength = 0; hmCommandBuffer[0] = '\0'; continue;
    }
    hmCommandBuffer[hmCommandLength++] = c;
  }
}

static void hmMaybeApplyPendingBaud() {
  if (!hmHasPendingBaudApply) return;
  if (static_cast<int32_t>(millis() - hmBaudApplyAtMs) < 0) return;
  hmHasPendingBaudApply = false;
  if (hmPendingBaud == hmActiveBaud) return;
  if (!hmApplyBaudChange(hmPendingBaud)) return;
  hmNeedsBootNormalize = false;
  hmStorePreferredBaud(hmPreferredBaud, false);
}

// -----------------------------------------------------------------------
// JSON output helpers
// -----------------------------------------------------------------------
static bool btSendValueText(const char *metric, const char *valueText) {
  char buf[MAX_LINE_BYTES + 1];
  const int len = snprintf(buf, sizeof(buf), "{\"metric\":\"%s\",\"value\":%s}\n",
                           metric, valueText);
  if (len <= 0 || len >= static_cast<int>(sizeof(buf))) return false;
  if (BT.overflow()) DBG.println(F("[WARN] BT RX overflow"));
  BT.listen(); BT.print(buf);
  DBG.print(F("[SEND] ")); DBG.print(buf);
  ledAckSend(); return true;
}

static bool btSendUint32(const char *metric, uint32_t value) {
  char vt[12];
  snprintf(vt, sizeof(vt), "%lu", static_cast<unsigned long>(value));
  return btSendValueText(metric, vt);
}

static void paceMetricSend() { delay(INTER_METRIC_DELAY_MS); wdt_reset(); }

// -----------------------------------------------------------------------
// HM-10 AT setup
// -----------------------------------------------------------------------
static bool tryAtHandshake(uint32_t baud) {
  BT.begin(baud); BT.listen(); delay(200);
  return hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS);
}

static bool hmHandshake() {
  DBG.println(F("[HM10] AT handshake..."));
  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++) {
    DBG.print(F("[HM10] Trying ")); DBG.print(HM10_SUPPORTED_UART_BAUDS[i]); DBG.print(F(" ... "));
    if (tryAtHandshake(HM10_SUPPORTED_UART_BAUDS[i])) {
      DBG.println(F("OK")); hmActiveBaud = HM10_SUPPORTED_UART_BAUDS[i]; return true;
    }
    DBG.println(F("no response")); ledBlink(1, 80, 80);
  }
  DBG.println(F("[ERR] HM-10 not responding."));
  hmActiveBaud = hmPreferredBaud; BT.begin(hmActiveBaud); BT.listen(); delay(200); return false;
}

static bool hmEnsurePreferredStreamingBaud() {
  hmWarnIfBaudMayBeNoisy(hmPreferredBaud);
  if (hmActiveBaud == hmPreferredBaud) { BT.begin(hmActiveBaud); BT.listen(); delay(200); return true; }
  return hmApplyBaudChange(hmPreferredBaud);
}

static void hmBlindNormalizeToPreferredBaud() {
  const char *targetCmd = hmBaudCommandFor(hmPreferredBaud);
  if (!targetCmd) { hmPreferredBaud = HM10_DEFAULT_UART_BAUD; targetCmd = hmBaudCommandFor(hmPreferredBaud); }
  DBG.print(F("[HM10] Blind-normalize to ")); DBG.print(hmPreferredBaud); DBG.println(F("..."));
  for (uint8_t i = 0; i < HM10_SUPPORTED_UART_BAUD_COUNT; i++) {
    BT.begin(HM10_SUPPORTED_UART_BAUDS[i]); BT.listen(); delay(180); hmDrainRx();
    BT.print("AT"); delay(80); BT.print(targetCmd); delay(140); BT.print(targetCmd); delay(140);
  }
  hmActiveBaud = hmPreferredBaud; BT.begin(hmActiveBaud); BT.listen(); delay(250);
}

static bool hmApplyPeripheralProfile() {
  DBG.println(F("[HM10] Applying BLE UART peripheral profile..."));
  bool ok = true;
  ok &= hmSendCommandExpect("AT+MODE0",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+ROLE0",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+IMME0",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+NOTI1",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+PWRM1",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+PCTL1",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+FFE20",       "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+UUID0xFFE0",  "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+CHAR0xFFE1",  "OK", AT_CONFIG_TIMEOUT_MS);
  ok &= hmSendCommandExpect("AT+RESET",       "OK", AT_CONFIG_TIMEOUT_MS);
  delay(300); BT.begin(hmActiveBaud); BT.listen(); delay(200);
  if (!hmSendCommandExpect("AT", "OK", AT_TIMEOUT_MS)) return false;
  if (!ok) DBG.println(F("[HM10] Partial config; continuing."));
  else DBG.println(F("[HM10] BLE UART profile confirmed."));
  return true;
}

// -----------------------------------------------------------------------
// Playback helpers
// -----------------------------------------------------------------------

// Returns inter-sample wait in ms, capped at MAX_GAP_MS and divided by speed.
static uint32_t waitMsForSample(uint16_t idx) {
  if (idx == 0) return 0;
  const uint16_t tCurr = pgm_read_word(&HR_TIME_S[idx]);
  const uint16_t tPrev = pgm_read_word(&HR_TIME_S[idx - 1]);
  uint32_t gapMs = static_cast<uint32_t>(tCurr - tPrev) * 1000UL;
  if (gapMs > MAX_GAP_MS) gapMs = MAX_GAP_MS;
  return gapMs / static_cast<uint32_t>(PLAYBACK_SPEED_X);
}

static void sendHrSample(uint16_t idx) {
  const uint8_t hr = pgm_read_byte(&HR_BPM[idx]);
  char vt[4];
  snprintf(vt, sizeof(vt), "%u", static_cast<unsigned int>(hr));
  btSendUint32(METRIC_HM10_LINK_PROBE, frameCount);
  paceMetricSend();
  btSendUint32(METRIC_TIME_MS, millis());
  paceMetricSend();
  btSendValueText(METRIC_EXERCISE_HR, vt);
}

// -----------------------------------------------------------------------
// setup()
// -----------------------------------------------------------------------
void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  DBG.begin(115200);
  delay(100);

  DBG.println(F(""));
  DBG.println(F("=== HR Activity Replay (Arduino + HM-10) ==="));
  DBG.print(F("[INFO] "));     DBG.print(HR_SAMPLE_COUNT);
  DBG.println(F(" samples, 84-190 bpm, 68 min activity"));
  DBG.print(F("[INFO] Speed: ")); DBG.print(PLAYBACK_SPEED_X);
  DBG.print(F("x  MaxGap: ")); DBG.print(MAX_GAP_MS); DBG.println(F(" ms"));
  DBG.println(F("[INFO] Metric: exercise.hr (Arduino + HM-10 profile)"));

  hmLoadPreferredBaud();
  DBG.print(F("[HM10] Preferred baud = ")); DBG.println(hmPreferredBaud);

  ledBlink(4, 80, 80);
  const bool useAtBoot = HM10_PROBE_BAUD_ON_BOOT || HM10_APPLY_BOOT_PROFILE;
  const bool shouldNorm = HM10_BLIND_NORMALIZE_TO_PREFERRED_BAUD_ON_BOOT && hmNeedsBootNormalize;
  if (shouldNorm) hmBlindNormalizeToPreferredBaud();

  if (useAtBoot) {
    hmOk = hmHandshake();
    if (hmOk) hmOk = hmEnsurePreferredStreamingBaud();
    if (hmOk && HM10_APPLY_BOOT_PROFILE) hmOk = hmApplyPeripheralProfile();
  } else {
    hmActiveBaud = hmPreferredBaud; BT.begin(hmActiveBaud); BT.listen(); delay(200); hmOk = true;
  }

  if (hmOk) {
    ledBlink(3, 200, 150);
    DBG.println(F("[HM10] Ready. Connect via 'Arduino + HM-10' profile (FFE0/FFE1)."));
    if (hmNeedsBootNormalize && (shouldNorm || useAtBoot)) {
      hmNeedsBootNormalize = false; hmStorePreferredBaud(hmPreferredBaud, false);
    }
  } else {
    digitalWrite(LED_PIN, HIGH);
    DBG.println(F("[ERR] HM-10 not fully confirmed; streaming anyway for diagnostics."));
  }

  DBG.println(F("[INFO] Streaming exercise.hr via JSON lines. Open Serial at 115200."));
  DBG.println(F("============================================"));

  hrIndex   = 0;
  playStartMs = millis();
  wdt_enable(WDTO_4S);
}

// -----------------------------------------------------------------------
// loop()
// -----------------------------------------------------------------------
void loop() {
  wdt_reset();
  hmPollIncomingCommands();
  hmMaybeApplyPendingBaud();

  const uint32_t waitMs = waitMsForSample(hrIndex);
  const uint32_t deadline = playStartMs + waitMs;

  // Poll commands while waiting for next sample
  while (static_cast<int32_t>(millis() - deadline) < 0) {
    wdt_reset();
    hmPollIncomingCommands();
    hmMaybeApplyPendingBaud();
  }

  sendHrSample(hrIndex);
  frameCount++;

  // Advance to next sample; loop back to start when done
  hrIndex++;
  if (hrIndex >= HR_SAMPLE_COUNT) {
    hrIndex = 0;
    DBG.println(F("[INFO] Data loop complete. Restarting from beginning."));
    ledBlink(2, 150, 100);
  }

  // Set the start reference for the next sample's wait
  playStartMs = millis();
}
