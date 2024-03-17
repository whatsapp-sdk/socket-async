const assert = require('assert');
const SocketAsync = require('../SocketAsync');
describe('SocketAsync', function () {
  it('getaddrinfo ENOTFOUND localhost', async () => {
    const socket = new SocketAsync();

    let host, port;
    try {
      host = 'localhost';
      port = 40007;
      await socket.connectAsync({
        host,
        port,
        timeout: 1000 * 5,
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
        timeout: 1000 * 5,
      });
    } catch (e) {
      console.error(e);
      assert(!!e.message.match('ECONNECTTIMEOUT'));
    }
  });

  it('ECONNECTTIMEOUT google.com', async () => {
    const socket = new SocketAsync();

    let host, port;

    host = 'google.com';
    port = 443;
    await socket.connectAsync({
      host,
      port,
      timeout: 1000 * 5,
      proxy: {
        host: '127.0.0.1',
        port: 1086,
      },
    });
    console.log('connect google.com with proxy successed.');
  });
});
