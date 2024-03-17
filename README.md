This is a basic socket library, based on net.Socket, it supports asynchronous writing, as well as http and socks5 proxies.

### example

```
const SocketAsync = require('socket-async');

const socket = new SocketAsync();

try{
  await socket.connectAsync({
    timeout: 1000 * 10, // 超时时间，建立连接的超时时间
    host: 'google.com', // 目标主机
    port: 443, // 目标端口
    proxy:{ // 代理信息
      host: '127.0.0.1', // 代理主机
      port: 1086, // 代理端口
      type: 'socks5', // 代理类型，默认为 socks5，仅支持 socks5 和 http
      username: '', // 用户名，如果需要鉴权时提供
      password: '', // 密码，如果需要鉴权时提供
      timeout: 1000 * 10 // 代理连接超时时间，单位 ms，默认 10 秒
    }
  });
}catch(e){
  console.error(e);
  // 如果代理故障，则会抛出 ProxyError 异常。
}

// 读取指定条件的数据
let chunks = await socket.readAsync((data)=>{
  return data.length > 3;
});

socket.spliceChunks(0,3); // 清空缓冲区的前三字节

// 读取缓冲区所有数据并清空缓冲区
chunks = await socket.readAndClearAsync((data)=> data.length);

```
