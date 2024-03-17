const assert = require('assert');
const SocketAsync = require('../SocketAsync');
describe('SocketAsync', function () {
  it('readAndClearAsync get google.com', async () => {
    const socket = new SocketAsync();

    let host, port;

    host = 'google.com';
    port = 80;
    await socket.connectAsync({
      host,
      port,
      timeout: 1000 * 5,
      proxy: {
        host: '127.0.0.1',
        port: 1086,
      },
    });
    socket.write('GET / HTTP/1.1\r\nHost: google.com\r\n\r\n');
    const chunks = await socket.readAndClearAsync((data) => data.length);
    const str = chunks.toString();
    assert(str.includes('HTTP/1.1 301 Moved Permanently'));
  });

  it('getaddrinfo ENOTFOUND localhost', async () => {
    const socket = new SocketAsync();

    let host, port;
    try {
      host = 'localhost';
      port = 40007;
      await socket.connectAsync({
        host,
        port,
        timeout: 1000 * 2,
      });
    } catch (e) {
      assert(!!e.message.match('ENOTFOUND'));
    }
  });

  it('ECONNECTTIMEOUT google.com', async () => {
    const socket = new SocketAsync();

    let host, port;
    try {
      host = 'google.com';
      port = 443;
      await socket.connectAsync({
        host,
        port,
        timeout: 1000 * 2,
      });
    } catch (e) {
      console.error(e);
      assert(!!e.message.match('ECONNECTTIMEOUT'));
    }
  });
});
