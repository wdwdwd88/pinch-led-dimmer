#include <TaskScheduler.h>
#include <LiquidCrystal_I2C.h>

// =====================================
// 1. Pin Settings
// =====================================
const uint8_t BUTTON_PIN  = 2;
const uint8_t LED_PIN     = 8;
const uint8_t PWM_LED_PIN = 9;
const uint8_t POT_PIN     = A0;

LiquidCrystal_I2C lcd(0x27, 16, 2);

// =====================================
// 2. Global Variables
// =====================================
bool ledState = false;

int pwmValue = 0;

// Last reported potentiometer value
int potValue = -1;

// Minimum potentiometer change
const int POT_THRESHOLD = 5;

// Interrupt variables
volatile bool buttonEvent = false;
volatile unsigned long lastInterruptTime = 0;

// Button debounce interval
const unsigned long DEBOUNCE_MS = 50;

// =====================================
// 3. Function Declarations
// =====================================
void buttonISR();
void taskButtonCallback();
void taskPotCallback();
void taskSerialCallback();
void taskLCDCallback();
void setLED(bool state);
void setPWM(int value);
bool parsePWM(const char *text, int &value);

// =====================================
// 4. TaskScheduler
// =====================================
Scheduler runner;

// Button event processing: 10 ms
Task tButton(
  10, TASK_FOREVER,
  &taskButtonCallback, &runner, true
);

// Potentiometer measurement: 100 ms
Task tPot(
  100, TASK_FOREVER,
  &taskPotCallback, &runner, true
);

// Serial command processing: 20 ms
Task tSerial(
  20, TASK_FOREVER,
  &taskSerialCallback, &runner, true
);

// LCD updating: 100 ms
Task tLCD(
  100, TASK_FOREVER,
  &taskLCDCallback, &runner, true
);

// =====================================
// 5. External Interrupt (D2)
// =====================================
void buttonISR() {
  unsigned long now = millis();

  if (now - lastInterruptTime >= DEBOUNCE_MS) {
    buttonEvent = true;
    lastInterruptTime = now;
  }
}

// =====================================
// 6. LED Control
// =====================================
void setLED(bool state) {

  if (ledState == state) {
    return;
  }

  ledState = state;

  digitalWrite(
    LED_PIN,
    ledState ? HIGH : LOW
  );

  Serial.print("LED: ");
  Serial.println(ledState ? "ON" : "OFF");
}

// =====================================
// 7. PWM LED Control (D9)
// =====================================
void setPWM(int value) {

  value = constrain(value, 0, 255);

  if (pwmValue == value) {
    return;
  }

  pwmValue = value;
  analogWrite(PWM_LED_PIN, pwmValue);

  // Echo back so p5 can confirm the applied value
  Serial.print("PWM: ");
  Serial.println(pwmValue);
}

bool parsePWM(const char *text, int &value) {

  const char *p = text + 4;   // skip "PWM:"
  if (*p == ' ') p++;
  if (*p == '\0') return false;

  int v = 0;
  for (; *p; p++) {
    if (*p < '0' || *p > '9') return false;
    v = v * 10 + (*p - '0');
    if (v > 255) return false;
  }

  value = v;
  return true;
}

// =====================================
// 8. Task 1: Button Event
// =====================================
void taskButtonCallback() {
  bool event = false;

  noInterrupts();

  if (buttonEvent) {
    event = true;
    buttonEvent = false;
  }

  interrupts();

  if (event) {
    setLED(!ledState);
  }
}

// =====================================
// 9. Task 2: Potentiometer
//    Measurement interval: 100 ms
// =====================================
void taskPotCallback() {

  int value = analogRead(POT_PIN);

  if (potValue == -1 ||
      abs(value - potValue) >= POT_THRESHOLD) {

    potValue = value;

    Serial.print("POT: ");
    Serial.println(potValue);
  }
}

// =====================================
// 10. Task 3: Serial Communication
//     Check interval: 20 ms
//     Commands: ON / OFF / PWM:0~255
// =====================================
void taskSerialCallback() {

  static char command[16];
  static uint8_t index = 0;
  static bool overflow = false;

  while (Serial.available() > 0) {

    char c = Serial.read();

    // End of command
    if (c == '\n' || c == '\r') {

      if (overflow) {
        Serial.println("Command too long");
      }
      else if (index > 0) {

        command[index] = '\0';

        if (strcmp(command, "ON") == 0) {
          setLED(true);
        }
        else if (strcmp(command, "OFF") == 0) {
          setLED(false);
        }
        else if (strncmp(command, "PWM:", 4) == 0) {
          int value;
          if (parsePWM(command, value)) {
            setPWM(value);
          }
          else {
            Serial.println("Invalid PWM (0~255)");
          }
        }
        else {
          Serial.println("Invalid command");
        }
      }

      index = 0;
      overflow = false;
    }
    else if (!overflow) {

      // Convert lowercase to uppercase
      if (c >= 'a' && c <= 'z') {
        c -= ('a' - 'A');
      }

      if (index < sizeof(command) - 1) {
        command[index++] = c;
      }
      else {
        index = 0;
        overflow = true;
      }
    }
  }
}

// =====================================
// 11. Task 4: LCD Display
//     Line 1: "LED:ON  PWM:128"
//     Line 2: "POT: 512"
// =====================================
void taskLCDCallback() {

  static bool previousLED = false;
  static int previousPWM = -1;
  static int previousPOT = -1;
  static bool firstUpdate = true;

  // LCD Line 1: LED Status + PWM value
  if (firstUpdate ||
      ledState != previousLED ||
      pwmValue != previousPWM) {

    char line[17];
    snprintf(
      line, sizeof(line),
      "LED:%-3s PWM:%3d ",
      ledState ? "ON" : "OFF",
      pwmValue
    );

    lcd.setCursor(0, 0);
    lcd.print(line);

    previousLED = ledState;
    previousPWM = pwmValue;
  }

  // LCD Line 2: Potentiometer Value
  if (firstUpdate || potValue != previousPOT) {

    lcd.setCursor(0, 1);

    lcd.print("POT: ");
    if (potValue < 0) {
      lcd.print("----");
    }
    else {
      lcd.print(potValue);
    }
    lcd.print("          ");

    previousPOT = potValue;
  }

  firstUpdate = false;
}

// =====================================
// 12. Setup
// =====================================
void setup() {

  Serial.begin(9600);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(PWM_LED_PIN, OUTPUT);
  pinMode(POT_PIN, INPUT);

  digitalWrite(LED_PIN, LOW);
  analogWrite(PWM_LED_PIN, 0);

  lcd.init();
  lcd.backlight();
  lcd.clear();

  lastInterruptTime = millis() - DEBOUNCE_MS;

  attachInterrupt(
    digitalPinToInterrupt(BUTTON_PIN),
    buttonISR,
    FALLING
  );

  Serial.println("System Ready");
  Serial.println("Commands: ON / OFF / PWM:0~255");
  Serial.println("LED: OFF");
  Serial.println("PWM: 0");
}

// =====================================
// 13. Main Loop
// =====================================
void loop() {

  runner.execute();

}