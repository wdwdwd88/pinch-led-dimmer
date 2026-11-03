// =============================================================
//  Pinch Dimmer
//  엄지와 검지의 간격으로 슬라이더를 움직이고, 그 값을 Arduino로 보내
//  D9에 연결된 LED 밝기를 조절합니다.
//
//  수업 코드(손 인식 + 세로 슬라이더)에 Web Serial 전송을 더했습니다.
//  복잡한 통신은 serial-helper.js가 처리합니다. (serial-helper.js는 그대로 사용)
//
//  사용법: 가운데 손가락을 접으면 조절 모드 → 엄지·검지 간격으로 밝기 조절
//          가운데 손가락을 펴면 그 값으로 고정
// =============================================================

let handPose, video, slider;
let hands = [];
let sliderValue = 0;
let connections;

// ---------- 시리얼 ----------
let serial, connectButton, statusSpan;
let sentPwm = -1;      // 마지막으로 보낸 PWM 값
let sending = false;
let smoothValue = 0;   // 슬라이더가 따라갈 실수 값

let loadMsg = '';       // 캔버스에 띄울 안내/오류 문구

async function setup() {
  const cnv = createCanvas(640, 480);

  // 캔버스와 슬라이더를 한 상자에 넣어, 슬라이더가 항상 캔버스 왼쪽에 오도록 한다
  const box = createDiv();
  box.style('position', 'relative');
  box.style('width', width + 'px');
  cnv.parent(box);

  slider = createSlider(0, 100, 0, 1);
  slider.parent(box);
  slider.style('writing-mode', 'vertical-rl');
  slider.style('height', '440px');
  slider.style('width', '20px');
  slider.style('transform', 'rotate(180deg)');
  slider.position(10, 20);
  slider.input(updateSliderValue);

  // 카메라 먼저
  video = createCapture(VIDEO);   // 반전은 draw()에서 직접 한다
  video.size(640, 480);
  video.hide();

  // Arduino 연결 버튼과 상태 표시
  connectButton = createButton('Arduino 연결 / 해제');
  statusSpan = createSpan('  Arduino를 연결해 주세요.');
  if (typeof SerialHelper === 'undefined') {
    statusSpan.html('  ⚠ serial-helper.js가 없습니다. index.html에 &lt;script src="serial-helper.js"&gt;를 추가하세요.');
  } else {
    serial = new SerialHelper(9600, receiveLine, message => {
      statusSpan.html('  ' + message);
      if (message.startsWith('연결됨')) sentPwm = -1;   // 재연결 시 현재 값 다시 전송
    });
    connectButton.mousePressed(() => serial.toggle());
  }

  // 손 인식 (수업 코드와 같은 방식)
  if (typeof ml5 === 'undefined') {
    loadMsg = 'ml5가 없습니다. index.html에 ml5 스크립트를 추가하세요.';
    return;
  }
  loadMsg = '손 인식 모델 불러오는 중…';
  // 10초가 지나도 인식 결과가 한 번도 오지 않으면 모델을 못 불러온 것
  setTimeout(() => {
    if (loadMsg === '손 인식 모델 불러오는 중…') {
      loadMsg = '손 인식 모델을 불러오지 못했습니다. 인터넷 연결과 F12 콘솔 오류를 확인하세요.';
    }
  }, 10000);
  try {
    handPose = await ml5.handPose();
    // p5 1.x에서는 위 await가 모델 로딩을 기다리지 않는다.
    // 모델이 준비되기 전에 detectStart()를 부르면 인식이 멈춰 버리므로 ready까지 기다린다.
    if (handPose.ready) await handPose.ready;
    handPose.detectStart(video, gotHands);
    connections = handPose.getConnections();
  } catch (error) {
    loadMsg = '손 인식 오류: ' + error.message;
    console.error(error);
  }
}

function draw() {
  let adjustMode = isGrabMode(hands);

  // 거울처럼 보이도록 좌우 반전: 카메라 영상과 손 표시를 같은 좌표계에서 함께 뒤집는다
  // (p5 버전에 따라 flipped 옵션이 영상/좌표 중 한쪽에만 적용되어 손이 반대로 보이는 문제 방지)
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  drawSkeletons(hands);
  drawKeyPoints(hands);
  if (adjustMode) drawConnectedLine(hands);
  pop();

  if (adjustMode) {
    let v = getNormalizedDistance(hands);
    // 수업 코드: slider.value(c + 0.05*(v-c));
    // 슬라이더는 1 단위라 차이가 작으면 반올림되어 멈추므로, 실수 변수로 따라간 뒤 넣는다
    smoothValue = lerp(smoothValue, v, 0.2);
    slider.value(round(smoothValue));
  } else {
    smoothValue = Number(slider.value());   // 마우스로 움직인 값에서 이어서 시작
  }
  sliderValue = Number(slider.value());

  sendPwm();

  // 안내/오류 문구 (모델 로딩 중이거나 문제가 있을 때만)
  if (loadMsg) {
    noStroke(); fill(0, 0, 0, 170); rect(40, height - 50, width - 60, 34, 6);
    fill(255); textSize(15); textAlign(LEFT, CENTER);
    text(loadMsg, 52, height - 33);
  }
}

function gotHands(results) {
  hands = results;
  if (loadMsg) loadMsg = '';   // 인식이 돌기 시작함 → 안내 문구 지우기
}

function drawKeyPoints(hs) {
  for (let i = 0; i < hs.length; i++) {
    let hand = hs[i];
    for (let j = 0; j < hand.keypoints.length; j++) {
      let keypoint = hand.keypoints[j];
      fill(255, 0, 0);
      noStroke();
      circle(keypoint.x, keypoint.y, 10);
    }
  }
}

function drawSkeletons(hs) {
  if (!connections) return;   // 모델을 불러오기 전에는 건너뜀
  for (let i = 0; i < hs.length; i++) {
    let hand = hs[i];
    stroke(0, 255, 0);
    strokeWeight(2);
    for (const [a, b] of connections) {
      const start = hand.keypoints[a];
      const end = hand.keypoints[b];
      if (start && end) {
        line(start.x, start.y, end.x, end.y);
      }
    }
  }
}

// 가운데 손가락을 구부렸는지 확인
function isGrabMode(hs) {
  if (hs == null) return false;
  if (hs.length == 0) return false;
  let ks = hs[0].keypoints;
  if (ks.length != 21) return false;

  let palmLength   = dist(ks[0].x, ks[0].y, ks[9].x, ks[9].y);
  let grabDistance = dist(ks[0].x, ks[0].y, ks[12].x, ks[12].y);
  if (grabDistance > palmLength) return false;
  return true;
}

function drawConnectedLine(hs) {
  if (hs.length > 0) {
    let hand = hs[0];
    const a = hand.keypoints[4]; // 엄지 끝
    const b = hand.keypoints[8]; // 검지 끝
    stroke(255, 140, 0);
    strokeWeight(4);
    line(a.x, a.y, b.x, b.y);
    noFill();
    circle(a.x, a.y, 22);
    circle(b.x, b.y, 22);
  }
}

function getNormalizedDistance(hs) {
  if (hs.length > 0) {
    let ks = hs[0].keypoints;
    const a = ks[4]; // 엄지 끝
    const b = ks[8]; // 검지 끝
    const c = ks[0]; // 손목
    const d = ks[9]; // 중지 시작점
    let v = dist(a.x, a.y, b.x, b.y); // 엄지-검지 거리
    let p = dist(c.x, c.y, d.x, d.y); // 손바닥 길이
    let s = round(100 * (v / p)) - 15;
    return constrain(s, 0, 100);
  }
  return 0;
}

function updateSliderValue() {
  sliderValue = Number(slider.value());
}

// ---------- 슬라이더(0~100) → PWM(0~255) → Arduino ----------
// 슬라이더 값이 바뀌었을 때만, 이전 전송이 끝난 뒤에 보낸다
function sendPwm() {
  const pwm = round(map(sliderValue, 0, 100, 0, 255));
  if (!serial || !serial.writer || sending || pwm === sentPwm) return;
  sending = true;
  serial.send('PWM:' + pwm).then(ok => {
    if (ok) sentPwm = pwm;
    sending = false;
  });
}

// Arduino가 보내는 한 줄 처리
function receiveLine(line) {
  const message = line.trim().toUpperCase();
  // 연결하면 보드가 재시작되므로, 준비되면 현재 값을 다시 보낸다
  if (message === 'SYSTEM READY') sentPwm = -1;
}
