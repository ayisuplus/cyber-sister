# Amie API网关与服务治理设计

> [!IMPORTANT]
> 历史/未来方案归档：本文不代表 2026-10-01 内测实现。当前以仓库根 README、`docs/Spec_Amie_v1.0.md` 和 `docs/deployment/internal-runbook.md` 为准；微服务、Kubernetes、Redis、向量数据库、模型训练与公开发布均为后置方案。

**文档版本**：V1.0  
**设计日期**：2026年7月13日  
**设计目标**：统一入口、安全防护、流量管理、服务治理、可观测性

---

## 一、API网关架构

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              客户端层                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Web App   │  │  iOS App    │  │ Android App │  │  小程序      │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
└─────────┼───────────────┼───────────────┼───────────────┼──────────────────────┘
          │               │               │               │
          └───────────────┼───────────────┼───────────────┘
                          │               │
                          ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              接入层                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         Nginx 负载均衡器                                  │   │
│  │                    (SSL终止、限流、健康检查)                               │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         API Gateway (Kong)                                │   │
│  │              (认证、限流、路由、监控、日志)                                │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              服务层                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ 用户服务     │  │ 对话服务     │  │ 记忆服务     │  │ 工具服务     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Kong API网关配置

#### 1.2.1 服务配置

```yaml
# Kong 服务配置
services:
  # 用户服务
  - name: user-service
    url: http://user-service:3000
    connect_timeout: 5000
    write_timeout: 10000
    read_timeout: 10000
    retries: 3
  
  # 对话服务
  - name: chat-service
    url: http://chat-service:3000
    connect_timeout: 5000
    write_timeout: 30000
    read_timeout: 30000
    retries: 3
  
  # 记忆服务
  - name: memory-service
    url: http://memory-service:3000
    connect_timeout: 5000
    write_timeout: 10000
    read_timeout: 10000
    retries: 3
  
  # 工具服务
  - name: tool-service
    url: http://tool-service:3000
    connect_timeout: 5000
    write_timeout: 10000
    read_timeout: 10000
    retries: 3
  
  # 合规服务
  - name: compliance-service
    url: http://compliance-service:3000
    connect_timeout: 5000
    write_timeout: 10000
    read_timeout: 10000
    retries: 3
  
  # LLM服务
  - name: llm-service
    url: http://llm-service:8000
    connect_timeout: 10000
    write_timeout: 60000
    read_timeout: 60000
    retries: 2
```

#### 1.2.2 路由配置

```yaml
# Kong 路由配置
routes:
  # 认证路由
  - name: auth-routes
    service: user-service
    paths:
      - /api/auth
    methods:
      - POST
    strip_path: false
    preserve_host: false
  
  # 用户路由
  - name: user-routes
    service: user-service
    paths:
      - /api/user
    methods:
      - GET
      - PUT
      - DELETE
    strip_path: false
    preserve_host: false
  
  # 聊天路由
  - name: chat-routes
    service: chat-service
    paths:
      - /api/chat
    methods:
      - GET
      - POST
      - PUT
      - DELETE
    strip_path: false
    preserve_host: false
  
  # 记忆路由
  - name: memory-routes
    service: memory-service
    paths:
      - /api/memories
    methods:
      - GET
      - POST
      - PUT
      - DELETE
    strip_path: false
    preserve_host: false
  
  # 工具路由
  - name: tool-routes
    service: tool-service
    paths:
      - /api/tools
    methods:
      - GET
      - POST
      - PUT
      - DELETE
    strip_path: false
    preserve_host: false
  
  # 合规路由
  - name: compliance-routes
    service: compliance-service
    paths:
      - /api/compliance
    methods:
      - GET
      - POST
    strip_path: false
    preserve_host: false
  
  # LLM路由
  - name: llm-routes
    service: llm-service
    paths:
      - /api/llm
    methods:
      - POST
    strip_path: false
    preserve_host: false
```

#### 1.2.3 插件配置

```yaml
# Kong 插件配置
plugins:
  # JWT认证
  - name: jwt
    config:
      uri_param_names: [jwt]
      header_names: [Authorization]
      claims_to_verify: [exp]
      maximum_expiration: 3600
      run_on_preflight: false
  
  # 限流
  - name: rate-limiting
    config:
      minute: 100
      hour: 1000
      day: 10000
      policy: redis
      redis_host: redis-service
      redis_port: 6379
      redis_password: xxx
      fault_tolerant: true
      hide_client_headers: false
  
  # CORS
  - name: cors
    config:
      origins:
        - https://cyber-sister.com
        - https://www.cyber-sister.com
        - http://localhost:5173
      methods:
        - GET
        - POST
        - PUT
        - DELETE
        - OPTIONS
      headers:
        - Content-Type
        - Authorization
        - X-Request-ID
      exposed_headers:
        - X-Request-ID
      max_age: 3600
      credentials: true
  
  # 请求大小限制
  - name: request-size-limiting
    config:
      allowed_payload_size: 10
      size_unit: megabytes
  
  # 请求转换
  - name: request-transformer
    config:
      add:
        headers:
          - X-Request-ID:$(uuid)
          - X-Forwarded-For:$(http_x_forwarded_for)
          - X-Real-IP:$(remote_addr)
  
  # 响应转换
  - name: response-transformer
    config:
      add:
        headers:
          - X-Request-ID:$(http_x_request_id)
          - X-Response-Time:$(upstream_response_time)
  
  # 日志
  - name: file-log
    config:
      path: /var/log/kong/access.log
      reopen: true
  
  # 监控
  - name: prometheus
    config:
      per_consumer: true
      status_code_metrics: true
      latency_metrics: true
      bandwidth_metrics: true
  
  # 链路追踪
  - name: zipkin
    config:
      http_endpoint: http://jaeger:9411/api/v2/spans
      sample_ratio: 1
      include_credential: true
      traceid_byte_count: 16
      header_type: w3c
  
  # 熔断器
  - name: circuit-breaker
    config:
      threshold: 5
      timeout: 60
      volume_threshold: 10
      error_threshold_percentage: 50
  
  # 请求验证
  - name: request-validator
    config:
      verbose_response: false
      allowed_content_types:
        - application/json
        - multipart/form-data
  
  # IP限制
  - name: ip-restriction
    config:
      allow:
        - 10.0.0.0/8
        - 172.16.0.0/12
        - 192.168.0.0/16
      deny: []
  
  # Bot检测
  - name: bot-detection
    config:
      allow: []
      deny: []
```

### 1.3 Nginx负载均衡配置

```nginx
# Nginx 负载均衡配置
upstream api_gateway {
    least_conn;
    server kong-node-1:8000 weight=1 max_fails=3 fail_timeout=30s;
    server kong-node-2:8000 weight=1 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

upstream websocket_server {
    ip_hash;
    server ws-node-1:8080 weight=1 max_fails=3 fail_timeout=30s;
    server ws-node-2:8080 weight=1 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name api.cyber-sister.com;
    
    # SSL配置
    ssl_certificate /etc/nginx/ssl/cyber-sister.com.crt;
    ssl_certificate_key /etc/nginx/ssl/cyber-sister.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    
    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # API路由
    location /api/ {
        proxy_pass http://api_gateway;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # 缓冲设置
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        
        # 限流
        limit_req zone=api burst=20 nodelay;
    }
    
    # WebSocket路由
    location /ws/ {
        proxy_pass http://websocket_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # WebSocket超时
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    
    # 健康检查
    location /health {
        proxy_pass http://api_gateway/health;
        access_log off;
    }
    
    # 静态文件
    location /static/ {
        alias /var/www/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}

# HTTP重定向
server {
    listen 80;
    server_name api.cyber-sister.com;
    return 301 https://$server_name$request_uri;
}

# 限流配置
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=conn:10m;
```

---

## 二、服务发现与注册

### 2.1 Consul 配置

```json
// Consul 服务配置
{
  "services": [
    {
      "name": "user-service",
      "id": "user-service-1",
      "address": "10.0.1.10",
      "port": 3000,
      "tags": ["v1", "production"],
      "meta": {
        "version": "1.0.0",
        "team": "backend"
      },
      "check": {
        "http": "http://10.0.1.10:3000/health",
        "interval": "10s",
        "timeout": "5s",
        "deregister_critical_service_after": "30s"
      }
    },
    {
      "name": "chat-service",
      "id": "chat-service-1",
      "address": "10.0.1.11",
      "port": 3000,
      "tags": ["v1", "production"],
      "meta": {
        "version": "1.0.0",
        "team": "backend"
      },
      "check": {
        "http": "http://10.0.1.11:3000/health",
        "interval": "10s",
        "timeout": "5s",
        "deregister_critical_service_after": "30s"
      }
    },
    {
      "name": "memory-service",
      "id": "memory-service-1",
      "address": "10.0.1.12",
      "port": 3000,
      "tags": ["v1", "production"],
      "meta": {
        "version": "1.0.0",
        "team": "backend"
      },
      "check": {
        "http": "http://10.0.1.12:3000/health",
        "interval": "10s",
        "timeout": "5s",
        "deregister_critical_service_after": "30s"
      }
    },
    {
      "name": "llm-service",
      "id": "llm-service-1",
      "address": "10.0.1.13",
      "port": 8000,
      "tags": ["v1", "production", "gpu"],
      "meta": {
        "version": "1.0.0",
        "team": "ml"
      },
      "check": {
        "http": "http://10.0.1.13:8000/health",
        "interval": "10s",
        "timeout": "5s",
        "deregister_critical_service_after": "30s"
      }
    }
  ]
}
```

### 2.2 服务发现客户端

```javascript
// Consul 服务发现客户端
const Consul = require('consul');

class ServiceDiscovery {
  constructor() {
    this.consul = new Consul({
      host: process.env.CONSUL_HOST || 'consul-server',
      port: process.env.CONSUL_PORT || 8500
    });
  }

  // 注册服务
  async register(serviceConfig) {
    try {
      await this.consul.agent.service.register(serviceConfig);
      console.log(`Service ${serviceConfig.name} registered successfully`);
    } catch (error) {
      console.error('Service registration failed:', error);
      throw error;
    }
  }

  // 注销服务
  async deregister(serviceId) {
    try {
      await this.consul.agent.service.deregister(serviceId);
      console.log(`Service ${serviceId} deregistered successfully`);
    } catch (error) {
      console.error('Service deregistration failed:', error);
      throw error;
    }
  }

  // 发现服务
  async discover(serviceName, options = {}) {
    try {
      const services = await this.consul.health.service({
        service: serviceName,
        passing: true,
        ...options
      });

      return services.map(service => ({
        id: service.Service.ID,
        address: service.Service.Address,
        port: service.Service.Port,
        tags: service.Service.Tags,
        meta: service.Service.Meta
      }));
    } catch (error) {
      console.error('Service discovery failed:', error);
      throw error;
    }
  }

  // 获取单个服务实例（负载均衡）
  async getServiceInstance(serviceName) {
    const services = await this.discover(serviceName);
    
    if (services.length === 0) {
      throw new Error(`No healthy instances found for service: ${serviceName}`);
    }

    // 简单轮询负载均衡
    const instance = services[Math.floor(Math.random() * services.length)];
    return instance;
  }

  // 监听服务变化
  async watch(serviceName, callback) {
    const watcher = this.consul.watch({
      method: this.consul.health.service,
      options: {
        service: serviceName,
        passing: true
      }
    });

    watcher.on('change', (services) => {
      callback(services.map(service => ({
        id: service.Service.ID,
        address: service.Service.Address,
        port: service.Service.Port,
        tags: service.Service.Tags,
        meta: service.Service.Meta
      })));
    });

    watcher.on('error', (error) => {
      console.error('Service watch error:', error);
    });

    return watcher;
  }

  // 健康检查
  async checkHealth(serviceName) {
    try {
      const services = await this.discover(serviceName);
      return {
        service: serviceName,
        healthy: services.length > 0,
        instances: services.length,
        details: services
      };
    } catch (error) {
      return {
        service: serviceName,
        healthy: false,
        error: error.message
      };
    }
  }
}

// 使用示例
const serviceDiscovery = new ServiceDiscovery();

// 注册服务
await serviceDiscovery.register({
  name: 'user-service',
  id: 'user-service-1',
  address: '10.0.1.10',
  port: 3000,
  tags: ['v1', 'production'],
  check: {
    http: 'http://10.0.1.10:3000/health',
    interval: '10s',
    timeout: '5s'
  }
});

// 发现服务
const userServices = await serviceDiscovery.discover('user-service');

// 获取服务实例
const instance = await serviceDiscovery.getServiceInstance('user-service');
console.log(`Connecting to ${instance.address}:${instance.port}`);

// 监听服务变化
const watcher = await serviceDiscovery.watch('user-service', (services) => {
  console.log('Service instances updated:', services);
});
```

---

## 三、服务通信

### 3.1 REST客户端封装

```javascript
// REST客户端封装
const axios = require('axios');

class RestClient {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.serviceDiscovery = new ServiceDiscovery();
    this.timeout = options.timeout || 5000;
    this.retries = options.retries || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  // 获取服务实例
  async getInstance() {
    return await this.serviceDiscovery.getServiceInstance(this.serviceName);
  }

  // 发送请求
  async request(method, path, data = null, options = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const instance = await this.getInstance();
        const url = `http://${instance.address}:${instance.port}${path}`;
        
        const config = {
          method,
          url,
          data,
          timeout: options.timeout || this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': this.generateRequestId(),
            'X-Service-Name': 'api-gateway',
            ...options.headers
          }
        };

        const response = await axios(config);
        return response.data;
      } catch (error) {
        lastError = error;
        
        if (attempt < this.retries) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }
    
    throw lastError;
  }

  // GET请求
  async get(path, options = {}) {
    return this.request('GET', path, null, options);
  }

  // POST请求
  async post(path, data, options = {}) {
    return this.request('POST', path, data, options);
  }

  // PUT请求
  async put(path, data, options = {}) {
    return this.request('PUT', path, data, options);
  }

  // DELETE请求
  async delete(path, options = {}) {
    return this.request('DELETE', path, null, options);
  }

  // 生成请求ID
  generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 延迟
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 使用示例
const userClient = new RestClient('user-service', {
  timeout: 5000,
  retries: 3
});

// 获取用户信息
const user = await userClient.get('/api/user/profile', {
  headers: { Authorization: `Bearer ${token}` }
});

// 创建用户
const newUser = await userClient.post('/api/auth/register', {
  phone: '13800138000'
});
```

### 3.2 gRPC服务通信

```protobuf
// user.proto
syntax = "proto3";

package cyber_sister;

service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc CreateUser (CreateUserRequest) returns (User);
  rpc UpdateUser (UpdateUserRequest) returns (User);
  rpc DeleteUser (DeleteUserRequest) returns (Empty);
  rpc ListUsers (ListUsersRequest) returns (ListUsersResponse);
}

message GetUserRequest {
  string id = 1;
}

message CreateUserRequest {
  string phone = 1;
  string nickname = 2;
  string persona = 3;
}

message UpdateUserRequest {
  string id = 1;
  string nickname = 2;
  string persona = 3;
  string avatar_url = 4;
}

message DeleteUserRequest {
  string id = 1;
}

message ListUsersRequest {
  int32 page = 1;
  int32 page_size = 2;
}

message ListUsersResponse {
  repeated User users = 1;
  int32 total = 2;
}

message User {
  string id = 1;
  string phone = 2;
  string nickname = 3;
  string persona = 4;
  bool is_vip = 5;
  string created_at = 6;
}

message Empty {}
```

```javascript
// gRPC客户端
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

class GrpcClient {
  constructor(protoPath, serviceName) {
    this.packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    this.proto = grpc.loadPackageDefinition(this.packageDefinition);
    this.serviceName = serviceName;
    this.serviceDiscovery = new ServiceDiscovery();
  }

  // 获取客户端实例
  async getClient() {
    const instance = await this.serviceDiscovery.getServiceInstance(this.serviceName);
    const address = `${instance.address}:${instance.port}`;
    
    const ServiceConstructor = this.proto.cyber_sister.UserService;
    return new ServiceConstructor(address, grpc.credentials.createInsecure());
  }

  // 调用方法
  async call(method, request) {
    const client = await this.getClient();
    
    return new Promise((resolve, reject) => {
      client[method](request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }
}

// 使用示例
const userGrpc = new GrpcClient('./proto/user.proto', 'user-service');

// 获取用户
const user = await userGrpc.call('GetUser', { id: 'user-123' });

// 创建用户
const newUser = await userGrpc.call('CreateUser', {
  phone: '13800138000',
  nickname: '小美',
  persona: 'toxic'
});
```

---

## 四、限流与熔断

### 4.1 限流策略

```javascript
// 限流中间件
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

class RateLimiter {
  constructor() {
    this.redis = new Redis();
  }

  // 创建限流器
  createLimiter(options = {}) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => this.redis.call(...args)
      }),
      windowMs: options.windowMs || 15 * 60 * 1000, // 15分钟
      max: options.max || 100, // 最大请求数
      message: options.message || 'Too many requests, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      },
      skip: (req) => {
        // 健康检查不限流
        return req.path === '/health';
      }
    });
  }

  // API限流
  apiLimiter() {
    return this.createLimiter({
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 100 // 每个IP 100次请求
    });
  }

  // 登录限流
  loginLimiter() {
    return this.createLimiter({
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 5, // 每个IP 5次尝试
      message: 'Too many login attempts, please try again later.'
    });
  }

  // 发送验证码限流
  sendCodeLimiter() {
    return this.createLimiter({
      windowMs: 60 * 1000, // 1分钟
      max: 1, // 每个IP 1次
      message: 'Please wait before requesting another code.'
    });
  }

  // LLM调用限流
  llmLimiter() {
    return this.createLimiter({
      windowMs: 60 * 1000, // 1分钟
      max: 10, // 每个用户每分钟10次
      keyGenerator: (req) => {
        return req.user?.userId || req.ip;
      },
      message: 'LLM rate limit exceeded, please try again later.'
    });
  }
}

// 使用示例
const rateLimiter = new RateLimiter();

// API限流
app.use('/api/', rateLimiter.apiLimiter());

// 登录限流
app.use('/api/auth/login', rateLimiter.loginLimiter());

// 发送验证码限流
app.use('/api/auth/send-code', rateLimiter.sendCodeLimiter());

// LLM调用限流
app.use('/api/llm/', rateLimiter.llmLimiter());
```

### 4.2 熔断器

```javascript
// 熔断器实现
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
    this.volumeThreshold = options.volumeThreshold || 10;
    this.errorThresholdPercentage = options.errorThresholdPercentage || 50;
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }

  // 执行操作
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  // 成功回调
  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.reset();
    }
    this.successCount++;
  }

  // 失败回调
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.trip();
    } else if (this.failureCount >= this.failureThreshold) {
      this.trip();
    }
  }

  // 打开熔断器
  trip() {
    this.state = 'OPEN';
    this.nextAttempt = Date.now() + this.resetTimeout;
  }

  // 重置熔断器
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }

  // 获取状态
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt
    };
  }
}

// 使用示例
const llmCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
  volumeThreshold: 10,
  errorThresholdPercentage: 50
});

// 调用LLM服务
async function callLLMService(message) {
  return llmCircuitBreaker.execute(async () => {
    const response = await axios.post('http://llm-service/api/llm/generate', {
      message,
      timeout: 30000
    });
    return response.data;
  });
}

// 监控熔断器状态
setInterval(() => {
  const state = llmCircuitBreaker.getState();
  console.log('Circuit Breaker State:', state);
  
  // 发送监控指标
  prometheus.circuitBreakerState.set({ service: 'llm' }, state.state === 'CLOSED' ? 0 : 1);
  prometheus.circuitBreakerFailures.set({ service: 'llm' }, state.failureCount);
}, 10000);
```

---

## 五、监控与告警

### 5.1 Prometheus监控配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  # API Gateway
  - job_name: 'kong'
    static_configs:
      - targets: ['kong:8001']
    metrics_path: /metrics
  
  # 用户服务
  - job_name: 'user-service'
    static_configs:
      - targets: ['user-service:3000']
    metrics_path: /metrics
  
  # 对话服务
  - job_name: 'chat-service'
    static_configs:
      - targets: ['chat-service:3000']
    metrics_path: /metrics
  
  # 记忆服务
  - job_name: 'memory-service'
    static_configs:
      - targets: ['memory-service:3000']
    metrics_path: /metrics
  
  # LLM服务
  - job_name: 'llm-service'
    static_configs:
      - targets: ['llm-service:8000']
    metrics_path: /metrics
  
  # PostgreSQL
  - job_name: 'postgresql'
    static_configs:
      - targets: ['postgres-exporter:9187']
  
  # Redis
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
  
  # Node Exporter
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

rule_files:
  - "alerts.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

### 5.2 告警规则

```yaml
# alerts.yml
groups:
  - name: service_alerts
    rules:
      # 服务宕机
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.job }} is down"
          description: "{{ $labels.job }} has been down for more than 1 minute"
      
      # 高错误率
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error rate on {{ $labels.job }}"
          description: "Error rate is {{ $value | humanizePercentage }}"
      
      # 高延迟
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High latency on {{ $labels.job }}"
          description: "95th percentile latency is {{ $value }}s"
      
      # 高CPU使用率
      - alert: HighCPUUsage
        expr: process_cpu_seconds_total > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage on {{ $labels.job }}"
          description: "CPU usage is {{ $value | humanizePercentage }}"
      
      # 高内存使用率
      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / node_memory_MemTotal_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage on {{ $labels.job }}"
          description: "Memory usage is {{ $value | humanizePercentage }}"
  
  - name: database_alerts
    rules:
      # PostgreSQL连接数
      - alert: PostgreSQLHighConnections
        expr: pg_stat_activity_count > 150
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL high connections"
          description: "Connection count is {{ $value }}"
      
      # PostgreSQL复制延迟
      - alert: PostgreSQLReplicationLag
        expr: pg_replication_lag > 30
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL replication lag"
          description: "Replication lag is {{ $value }}s"
      
      # Redis内存使用率
      - alert: RedisHighMemory
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis high memory usage"
          description: "Memory usage is {{ $value | humanizePercentage }}"
  
  - name: business_alerts
    rules:
      # 危机事件
      - alert: CrisisEventDetected
        expr: increase(crisis_events_total[5m]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Crisis event detected"
          description: "{{ $value }} crisis events in the last 5 minutes"
      
      # LLM服务不可用
      - alert: LLMServiceUnavailable
        expr: circuit_breaker_state{service="llm"} == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "LLM service unavailable"
          description: "LLM circuit breaker is open"
```

### 5.3 Grafana仪表板

```json
{
  "dashboard": {
    "title": "Amie服务监控",
    "panels": [
      {
        "title": "服务状态",
        "type": "stat",
        "targets": [
          {
            "expr": "up",
            "legendFormat": "{{ job }}"
          }
        ]
      },
      {
        "title": "请求速率",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{ job }} - {{ method }}"
          }
        ]
      },
      {
        "title": "错误率",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m])",
            "legendFormat": "{{ job }}"
          }
        ]
      },
      {
        "title": "延迟分布",
        "type": "heatmap",
        "targets": [
          {
            "expr": "rate(http_request_duration_seconds_bucket[5m])",
            "legendFormat": "{{ le }}"
          }
        ]
      },
      {
        "title": "数据库连接数",
        "type": "graph",
        "targets": [
          {
            "expr": "pg_stat_activity_count",
            "legendFormat": "PostgreSQL"
          },
          {
            "expr": "redis_connected_clients",
            "legendFormat": "Redis"
          }
        ]
      },
      {
        "title": "内存使用率",
        "type": "gauge",
        "targets": [
          {
            "expr": "process_resident_memory_bytes / node_memory_MemTotal_bytes",
            "legendFormat": "{{ job }}"
          }
        ]
      }
    ]
  }
}
```

---

## 六、日志管理

### 6.1 ELK配置

```yaml
# elasticsearch.yml
cluster.name: cyber-sister-logs
node.name: es-node-1
network.host: 0.0.0.0
discovery.seed_hosts: ["es-node-1", "es-node-2", "es-node-3"]
cluster.initial_master_nodes: ["es-node-1", "es-node-2", "es-node-3"]

# logstash.conf
input {
  beats {
    port => 5044
  }
}

filter {
  json {
    source => "message"
  }
  
  date {
    match => ["timestamp", "ISO8601"]
    target => "@timestamp"
  }
  
  mutate {
    add_field => { "service" => "%{[kubernetes][labels][app]}" }
  }
}

output {
  elasticsearch {
    hosts => ["es-node-1:9200", "es-node-2:9200", "es-node-3:9200"]
    index => "cyber-sister-logs-%{+YYYY.MM.dd}"
  }
}

# filebeat.yml
filebeat.inputs:
  - type: container
    paths:
      - /var/log/containers/*.log
    processors:
      - add_kubernetes_metadata:
          host: ${NODE_NAME}
          matchers:
            - logs_path:
                logs_path: "/var/log/containers/"

output.logstash:
  hosts: ["logstash:5044"]
```

### 6.2 结构化日志

```javascript
// 结构化日志中间件
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

class Logger {
  constructor(serviceName) {
    this.serviceName = serviceName;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: serviceName },
      transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
          format: winston.format.simple()
        }),
        new ElasticsearchTransport({
          level: 'info',
          clientOpts: { node: 'http://es-node-1:9200' },
          indexPrefix: 'cyber-sister-logs'
        })
      ]
    });
  }

  // 请求日志
  requestLogger() {
    return (req, res, next) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        
        this.logger.info('HTTP Request', {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          userId: req.user?.userId,
          requestId: req.headers['x-request-id']
        });
      });
      
      next();
    };
  }

  // 错误日志
  errorLogger() {
    return (err, req, res, next) => {
      this.logger.error('Unhandled Error', {
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.url,
        userId: req.user?.userId,
        requestId: req.headers['x-request-id']
      });
      
      res.status(500).json({ error: 'Internal Server Error' });
    };
  }

  // 业务日志
  businessLog(action, data) {
    this.logger.info('Business Action', {
      action,
      ...data
    });
  }

  // 安全日志
  securityLog(event, data) {
    this.logger.warn('Security Event', {
      event,
      ...data
    });
  }
}

// 使用示例
const logger = new Logger('user-service');

// 请求日志
app.use(logger.requestLogger());

// 错误日志
app.use(logger.errorLogger());

// 业务日志
logger.businessLog('user_login', {
  userId: 'user-123',
  ip: '192.168.1.1'
});

// 安全日志
logger.securityLog('failed_login', {
  ip: '192.168.1.1',
  reason: 'invalid_password'
});
```

---

## 七、总结

本API网关与服务治理设计通过Kong、Consul、Prometheus、ELK等组件，实现了：

1. **统一入口**：Kong API网关统一管理所有API请求
2. **安全防护**：JWT认证、限流、CORS、IP限制等安全措施
3. **流量管理**：负载均衡、限流、熔断等流量控制
4. **服务治理**：服务发现、健康检查、自动恢复等治理能力
5. **可观测性**：监控、告警、日志、链路追踪等可观测性能力

该架构可支持DAU 5万的目标，并具备向更高规模扩展的能力。
