/* Транспорт синхронизации: публичные MQTT-брокеры по WebSocket.
 * Перебираем брокеры по кругу: если один не отвечает — пробуем следующий.
 * Библиотека mqtt.js лежит локально в js/vendor и подключается в index.html. */

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081',
];

const PREFIX = 'svoyak-app';
const CONNECT_TIMEOUT = 8000;   // сколько ждём подключения к одному брокеру
const RETRY_DELAY = 5000;       // пауза перед новым кругом

export function connect({ onMessage, onStatus }) {
  let client = null;
  let connected = false;
  let stopped = false;
  let brokerIdx = 0;
  let timer = null;

  function detach() {
    if (client) {
      client.removeAllListeners();
      client.end(true);
      client = null;
    }
  }

  function attempt() {
    if (stopped) return;
    clearTimeout(timer);
    detach();
    if (brokerIdx >= BROKERS.length) {
      brokerIdx = 0;
      timer = setTimeout(attempt, RETRY_DELAY);
      return;
    }
    const url = BROKERS[brokerIdx];
    brokerIdx += 1;

    const c = window.mqtt.connect(url, {
      clientId: `svoyak_${Math.random().toString(16).slice(2, 10)}`,
      keepalive: 30,
      reconnectPeriod: 0,     // переподключением управляем сами (перебирая брокеров)
      connectTimeout: CONNECT_TIMEOUT,
      clean: true,
    });
    client = c;

    timer = setTimeout(() => {
      if (!connected) attempt();
    }, CONNECT_TIMEOUT);

    c.on('connect', () => {
      connected = true;
      clearTimeout(timer);
      onStatus?.('online');
    });
    c.on('close', () => {
      if (stopped) return;
      if (connected) {
        connected = false;
        onStatus?.('connecting');
        clearTimeout(timer);
        timer = setTimeout(attempt, 2000);
      }
    });
    c.on('error', () => { /* ждём close или таймаут подключения */ });
    c.on('message', (topic, payload) => {
      const msg = parse(payload);
      if (msg) onMessage?.(topic, msg);
    });
  }

  attempt();

  return {
    get connected() { return connected; },
    subscribe(shortTopic) {
      client?.subscribe(`${PREFIX}/${shortTopic}`);
    },
    publish(shortTopic, obj, opts) {
      // При обрыве связи mqtt.js поставит сообщение в очередь и доставит после переподключения.
      return new Promise((resolve) => {
        client?.publish(`${PREFIX}/${shortTopic}`, JSON.stringify(obj), opts ?? {}, () => resolve());
        if (!client) resolve();
      });
    },
    end() {
      stopped = true;
      clearTimeout(timer);
      detach();
    },
  };
}

function parse(payload) {
  try {
    return JSON.parse(payload.toString());
  } catch {
    return null;
  }
}
