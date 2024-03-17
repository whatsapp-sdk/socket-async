/**
 * @fileoverview
 * 简化版本的 net.Socket，支持异步写法，支持代理。
 * 20240216 by yisbug
 */

const assert = require('assert');
const net = require('net');

const ERROR_MAP = {
  1: '代理服务器故障',
  2: '代理服务器规则集不允许连接',
  3: '网络无法访问',
  4: '目标服务器无法访问（主机名无效）',
  5: '连接目标服务器被拒绝',
  6: 'TTL已过期',
  7: '不支持的命令',
  8: '不支持的目标服务器地址类型',
};

// eslint-disable-next-line
class ProxyError extends Error {
  constructor(args) {
    super(args);
    this.name = 'ProxyError';
  }
}

/**
 * 20240216 by yisbug
 *
 * net.Socket支持的事件如下：
 * close 连接被关闭
 * connect 建立连接成功
 * data 接收到数据
 * drain
 * end 连接被主动断开？
 * error 出错
 * lookup
 * ready
 * timeout
 *
 * 简单的重写 net.Socket 模块的几个方法，主要增加了以下特性：
 * 1. 从简单的 Event 模型的基础上，支持异步写法，方便业务方统一处理异常。
 *
 *
 *
 */
class SocketAsync extends net.Socket {
  constructor(options) {
    super(options);

    this.logger = options?.logger ?? console;
    // 缓冲区
    this.chunks = Buffer.alloc(0);
    this.error = null;

    this.on('data', (data) => {
      this.logger.debug('socket ondata length', data.length);
      this.chunks = Buffer.concat([this.chunks, data]);
    });
    this.on('timeout', () => {
      this.logger.debug('socket on timeout.');
      if (!this.error) {
        this.error = new Error('ESOCKETTIMEOUT');
      }
      this.destroy(); // 超时时，需要手动释放
    });
    this.on('error', (e) => {
      this.logger.error('socket on error:', e);
      if (!this.error) {
        this.error = e;
      }
      this.destroy();
    });
    this.on('end', () => {
      this.logger.debug('socket on end fin.');
      if (!this.error) {
        this.error = new Error('EENDFIN');
      }
      this.destroy();
    });
    this.on('close', () => {
      this.logger.debug('socket on close.');
      if (!this.error) {
        this.error = new Error('ESOCKETCLOSED');
      }
    });
  }

  /**
   * 和 socket.connect(options[, connectListener]) 的区别：
   * 1. 去掉 connectListener，直接返回 Promise 对象
   * 2. options 中支持 timeout 参数，即建立连接时的超时时间。
   *
   * 问题：
   * 官方的 socket.setTimeout() 方法也可以设置超时时间，为什么要单独设置建立连接的超时时间？
   * 1. socket.setTimeout() 的定义是，socket 空闲时的超时时间。但实际上，如果调用此方法设置超时时间后，建立连接时超时也会触发 timeout。
   * 2. 实际业务中，建立连接的超时和连接成功后的超时并不一样。例如我的预期是建立连接的超时时间为 10 秒，建立连接之后的心跳检测为 30 秒，那么就需要设置两次。
   *
   * @example
   * ```
   * try{
   *  await socket.connectAsync({
   *    host:'google.com',
   *    port: 443
   *  })
   * }catch(e){
   *  // 如果没有翻墙的话，可以捕获到一个 EConnectTimeout 错误信息
   *  this.logger.error(e);
   * }
   * ```
   * @param {Object} options
   * @param {Number} options.timeout - 超时时间，建立连接的超时时间
   * @param {String} options.host - 目标主机
   * @param {Number} options.port - 目标端口
   * @param {Object} options.proxy - 代理信息
   * @param {String} options.proxy.host - 代理主机
   * @param {Number} options.proxy.port - 代理端口
   * @param {String} [options.proxy.type = socks5] - 代理类型，默认为 socks5，仅支持 socks5 和 http
   * @param {String} [options.proxy.username] - 用户名，如果需要鉴权时提供
   * @param {String} [options.proxy.password] - 密码，如果需要鉴权时提供
   * @param {Number} [options.proxy.timeout = 10000] - 代理连接超时时间，单位 ms，默认 10 秒
   */
  async connectAsync(options) {
    if (options.proxy) {
      return this._connectWithProxyAsync(options);
    }
    return this._connectWithoutProxyAsync(options);
  }

  /**
   * 读取数据，支持异步写法。
   * @param {Function} [callback] 回调函数，该函数必须返回 true/false，返回 true 时，停止读取数据。参数为 Buffer 类型的数据。
   * @param {Number} [timeout = 0] 超时时间，默认无超时，单位 ms
   * @returns {Promise<void>}
   */
  async readAsync(callback, timeout) {
    const self = this;
    let oldTimeout; // socket默认的 timeout 为 undefined
    return new Promise((resolve, reject) => {
      let removeAllListeners;
      // 每次接收到数据时，都会触发此事件，检测是否满足条件。满足时，resolve chunks 数据。
      function onData(buffer) {
        // 未指定回调，或者回调函数返回 true
        if (!callback || (typeof callback === 'function' && callback(self.chunks))) {
          removeAllListeners();
          /**
           * @TODO 如果此处为异步处理，那么在resolve之后spliceChunks可能会出现问题。期间可能会接收到新的数据。经过测试，执行顺序为：
           * 1. removeAllListeners
           * 2. resolve
           * 3. resolve之后的代码
           * 4. 调用该函数resolve之后的代码，即 await readAsync() 之后的代码
           * 5. spliceChunks
           * 6. 如果有的话，触发 on('data') 事件。
           *
           * 所以，如下代码不会出现问题：
           *
           * ```
           * await this.readAsync(); // 读取数据
           * this.spliceChunks(0); // 清空缓冲区，同步执行的。
           * await this.readAsync(); // 继续读取数据
           * ```
           */
          resolve(self.chunks);
        }
      }
      // 对方发 FIN 包时会触发 end 事件
      function onEnd() {
        removeAllListeners();
        reject(new Error('EENDFIN'));
      }
      // 异常错误
      function onError(e) {
        removeAllListeners();
        reject(e);
      }
      // 超时
      function onTimeout() {
        removeAllListeners();
        reject(new Error('ESOCKETTIMEOUT'));
      }
      // 监听 close 事件兜底。如果没有触发上面的事件，那么就是 close 事件了。
      function onClose() {
        removeAllListeners();
        reject(new Error('ESOCKETCLOSED'));
      }
      removeAllListeners = () => {
        // 清空此处监听的所有事件
        this.removeListener('data', onData);
        this.removeListener('timeout', onTimeout);
        this.removeListener('error', onError);
        this.removeListener('end', onEnd);
        this.removeListener('close', onClose);
        // 恢复或者清空 默认的 timeout
        this.setTimeout(oldTimeout || 0);
      };
      oldTimeout = this.timeout;
      // 单独设置此次超时时间。使用自带的 setTimeout 方法实现。
      if (timeout) {
        this.setTimeout(timeout);
      }
      this.on('data', onData);
      this.once('error', onError);
      this.once('timeout', onTimeout);
      this.once('end', onEnd);
      this.once('close', onClose);
      if (this.chunks && this.chunks.length) {
        onData(this.chunks);
      }
    });
  }

  /**
   * 读取数据并清空缓冲区
   * @param {Function} callback
   * @param {Number} timeout
   * @returns
   */
  async readAndClearAsync(callback, timeout) {
    const chunks = await this.readAsync(callback, timeout);
    this.spliceChunks(0);
    return chunks;
  }

  /**
   * 清空一部分缓冲区数据 Buffer
   * @param {Number} [start] - 起始索引，默认为 0
   * @param {Number} [end] - 结束索引，默认为 chunks.length
   * @returns 分割后的 Buffer
   */
  spliceChunks(start = 0, end = this.chunks.length) {
    const chunks = this.chunks.subarray(start, end);
    this.chunks = Buffer.concat([this.chunks.subarray(0, start), this.chunks.subarray(end)]);
    return chunks;
  }

  /**
   * 直接建立连接，内部方法
   * @param {Object} options
   * @returns
   */
  async _connectWithoutProxyAsync(options) {
    return new Promise((resolve, reject) => {
      const self = this;
      let oldTimeout; // socket默认的 timeout 为 undefined
      let removeAllListeners;
      function onConnect() {
        removeAllListeners();
        resolve();
      }
      function onError(e) {
        removeAllListeners();
        reject(e);
      }
      function onTimeout() {
        removeAllListeners();
        reject(new Error('ECONNECTTIMEOUT'));
      }
      // 监听 close 事件兜底。如果没有触发上面的事件，那么就是 close 事件了。
      function onClose() {
        removeAllListeners();
        reject(new Error('ESOCKETCLOSED'));
      }
      // 对方发 FIN 包时会触发 end 事件
      function onEnd() {
        removeAllListeners();
        reject(new Error('EENDFIN'));
      }
      removeAllListeners = () => {
        // 清空此处监听的所有事件
        this.removeListener('error', onError);
        this.removeListener('end', onEnd);
        this.removeListener('connect', onConnect);
        this.removeListener('timeout', onTimeout);
        this.removeListener('close', onClose);
        // 恢复或者清空 默认的 timeout
        this.setTimeout(oldTimeout || 0);
      };

      // 只监听 3 个必要的事件。
      this.once('connect', onConnect);
      this.once('error', onError);
      this.once('timeout', onTimeout);
      this.once('close', onClose);
      this.once('end', onEnd);

      oldTimeout = this.timeout;
      // 单独设置建立连接的超时时间。使用自带的 setTimeout 方法实现。
      if (options?.timeout) {
        this.setTimeout(options.timeout);
      }
      // 直接透传 options 参数
      this.connect(options);
    });
  }

  /**
   * 使用代理连接，内部方法
   * @param {Object} options
   */
  async _connectWithProxyAsync(options) {
    const { proxy = {} } = options;
    const { host, port, timeout = 10000 } = proxy;
    let type = String(proxy.type || 'socks5').toLowerCase();

    try {
      assert(['socks5', 'http'].includes(type), 'The proxy type must be socks5 or http.');
      assert(host, 'options.proxy.host is required.');
      assert(port, 'options.proxy.port is required.');
      // 先连接代理
      await this.connectAsync({
        host: proxy.host,
        port: proxy.port,
        timeout,
      });
      // 连接目标主机
      // 此处如果做更细的拆分，可以拆分出两种错误：代理鉴权失败、连接目标主机失败。
      if (type === 'socks5') {
        await this._connectSocks5Proxy(options);
      } else {
        await this._connectHttpProxy(options);
      }
    } catch (e) {
      // 抛出代理错误异常
      throw new ProxyError(e);
    }
  }

  /**
   * 使用 http 代理
   * @param {Object} options
   */
  async _connectHttpProxy(options) {
    const { host, port, proxy } = options;
    const { username = '', password = '', timeout = 10000 } = proxy;
    // 构造并发送 http 请求头
    let header = `CONNECT ${host}:${port} HTTP/1.1\r\n`;
    header += 'Connection: keep-alive\r\n';
    header += 'Content-Length: 0\r\n';
    if (username) {
      const authInfo = Buffer.from(`${username}:${password}`).toString('base64');
      header += `Proxy-Authorization: Basic ${authInfo}\r\n`;
    }
    header += '\r\n';
    this.write(header);
    const chunks = await this.readAndClearAsync(null, timeout);
    const str = String(chunks.toString()).trim();
    if (!str.match(/^HTTP\/1\.[01] 200/i)) {
      throw new Error(`连接目标失败：${str}`);
    }
    // 连接成功
  }

  /**
   * 使用 socks5 代理
   * @param {Object} options
   */
  async _connectSocks5Proxy(options) {
    const { host, port, proxy } = options;
    const { username = '', password = '', timeout = 10000 } = proxy;
    /**
     * 0 - socks版本，固定 0x05
     * 1 - 支持的验证方法数量，默认支持无密码和有密码两种
     * 3 - 0x00
     * 4 - 如下：
     * 0x00 不需要验证
     * 0x01 GSSAPI认证
     * 0x02 账号密码认证（常用）
     * 0x03 - 0x7F IANA分配
     * 0x80 - 0xFE 私有方法保留
     * 0xFF 无支持的认证方法
     */
    let chunks = Buffer.alloc(0);

    // 握手，确认鉴权模式
    this.write(Buffer.from('05020002', 'hex'));
    chunks = await this.readAndClearAsync(null, timeout);
    if (chunks.length !== 2) {
      throw new Error('Unexpected number of bytes received.');
    }
    if (chunks[0] !== 0x05) {
      throw new Error(`Unexpected socks version number: ${chunks[0]}.`);
    }
    const authType = chunks[1];
    if (![0x00, 0x02].includes(authType)) {
      throw new Error(`Unexpected socks authentication method: ${authType}`);
    }

    // 需要鉴权，走鉴权流程
    if (authType === 0x02) {
      const authInfo = Buffer.concat([
        Buffer.from([0x01, Buffer.from(username).length]),
        Buffer.from(username),
        Buffer.from([password.length]),
        Buffer.from(password),
      ]);

      this.write(authInfo);
      chunks = await this.readAndClearAsync(null, timeout);
      if (chunks.length !== 2) {
        throw new Error('Unexpected number of bytes received.');
      }
      if (chunks[0] !== 0x01) {
        throw new Error(`Unexpected authentication method code: ${chunks[0]}.`);
      }
      if (chunks[1] !== 0x00) {
        throw new Error(`Username and password authentication failure: ${chunks[1]}.`);
      }
    }

    // 鉴权成功，连接真正的目标
    let targetInfo = Buffer.from('050100', 'hex');
    const targetType = net.isIP(host);
    // 端口 2 字节，补齐 0
    let hexPort = Number(port).toString(16);
    if (hexPort.length < 4) {
      hexPort = new Array(4 - hexPort.length + 1).join('0') + hexPort;
    }
    // 端口 2 字节
    const bufPort = Buffer.from(hexPort, 'hex');

    if (targetType === 4) {
      // ipv4
      targetInfo = Buffer.concat([
        targetInfo,
        Buffer.from([0x01]),
        // ipv4 4 字节
        Buffer.from(host.split('.')),
        bufPort,
      ]);
    } else if (targetType === 0) {
      // 域名
      targetInfo = Buffer.concat([
        targetInfo,
        // 0x03 标识后面的数据为 host
        Buffer.from([0x03, Buffer.from(host).length]),
        Buffer.from(host),
        bufPort,
      ]);
    } else if (targetType === 6) {
      // ipv6
      targetInfo = Buffer.concat([
        targetInfo,
        Buffer.from([0x04]),
        // ipv6 8 段，每段 2 字节，总计 16 字节。例如 1050:0:0:0:5:600:300c:326b
        Buffer.concat(
          host.split(':').map((item) => {
            let hex = String(item);
            hex = new Array(4 - hex.length + 1).join('0') + hex;
            return Buffer.from(hex, 'hex');
          })
        ),
        bufPort,
      ]);
    } else {
      // @TODO 支持 ipv6 targetType === 6
      throw new Error(`Not support target host: ${host}`);
    }
    this.write(targetInfo);

    chunks = await this.readAndClearAsync(null, timeout);
    if (chunks[0] !== 0x05) {
      throw new Error(`Unexpected SOCKS version number: ${chunks[0]}.`);
    }
    if (chunks[1] !== 0x00) {
      if (ERROR_MAP[chunks[1]]) {
        throw new Error(ERROR_MAP[chunks[1]]);
      }
      throw new Error(`未知错误，连接目标地址失败：${host}`);
    }
    // 通过代理连接成功
  }
}

module.exports = SocketAsync;
