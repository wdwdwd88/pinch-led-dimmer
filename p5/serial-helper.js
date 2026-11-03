// Web Serial 통신을 모아 둔 도우미입니다.
class SerialHelper {
  constructor(baudRate, onLine, onStatus) {
    this.baudRate = baudRate;
    this.onLine = onLine;
    this.onStatus = onStatus;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.busy = false;
    this.closing = false;
  }

  async toggle() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.port) { await this.disconnect(); return; }
      if (!('serial' in navigator)) {
        this.onStatus('Web Serial 지원 Chrome/Edge에서 실행해 주세요.');
        return;
      }
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: this.baudRate });
      this.writer = this.port.writable.getWriter();
      this.closing = false;
      this.onStatus('연결됨 · 9600 baud');
      this.readTask = this.readLines();
    } catch (error) {
      this.onStatus(error.name === 'NotFoundError' ? '포트 선택을 취소했습니다.' : '연결 오류: ' + error.message);
      await this.disconnect(false);
    } finally { this.busy = false; }
  }

  async send(command) {
    if (!this.writer || this.closing) {
      this.onStatus('먼저 Arduino를 연결해 주세요.');
      return false;
    }
    try {
      await this.writer.write(new TextEncoder().encode(command + '\n'));
      this.onStatus('전송: ' + command + ' · 9600 baud');
      return true;
    } catch (error) {
      this.onStatus('전송 오류: ' + error.message);
      return false;
    }
  }

  readLines() {
    const decoder = new TextDecoder();
    let buffer = '';
    const reader = this.port.readable.getReader();
    this.reader = reader;

    // 장시간 while 대신 수신할 때마다 다음 읽기를 예약합니다.
    // p5.js 편집기의 무한 반복 감지와 충돌하지 않습니다.
    return new Promise(resolve => {
      const finish = error => {
        reader.releaseLock();
        this.reader = null;
        const unexpected = !this.closing;
        if (unexpected) {
          this.onStatus(error ? '수신 오류: ' + error.message : '연결이 끊어졌습니다.');
        }
        resolve();
        if (unexpected) setTimeout(() => this.disconnect(false), 0);
      };

      const readNext = () => {
        if (this.closing) { finish(); return; }
        reader.read().then(({ value, done }) => {
          if (done || this.closing) { finish(); return; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach(line => {
            const message = line.trim();
            if (message) this.onLine(message);
          });
          if (buffer.length > 4096) buffer = '';
          setTimeout(readNext, 0);
        }).catch(finish);
      };
      readNext();
    });
  }

  async disconnect(showStatus = true) {
    this.closing = true;
    if (this.reader) await this.reader.cancel().catch(() => {});
    if (this.readTask) await this.readTask.catch(() => {});
    this.readTask = null;
    if (this.writer) { this.writer.releaseLock(); this.writer = null; }
    if (this.port) await this.port.close().catch(() => {});
    this.port = null;
    this.closing = false;
    if (showStatus) this.onStatus('연결 해제됨');
  }
}
