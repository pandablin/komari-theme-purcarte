// API 服务 - 用于与 Komari 后端通信
import type { NodeData, NodeStats, ApiResponse, PublicInfo, HistoryRecord, PingHistoryResponse } from '@/types/node'

class ApiService {
	private baseUrl: string

	constructor() {
		// 使用相对路径，这样在部署时会自动适配
		this.baseUrl = ''
	}

	async get<T>(endpoint: string): Promise<ApiResponse<T> | { status: number } | { status: string; message: string; data: any }> {
		try {
			const response = await fetch(`${this.baseUrl}${endpoint}`)
			if (!response.ok) {
				if (response.status === 401) {
					return { status: 401 }
				}
				// 对于其他 HTTP 错误，直接返回错误对象，而不是抛出异常
				return {
					status: 'error',
					message: `HTTP error! status: ${response.status}`,
					data: null as any
				}
			}
			const data = await response.json()
			return data
		} catch (error) {
			// 这个 catch 块现在只处理网络层面的错误
			console.error('API request failed (network error):', error)
			return {
				status: 'error',
				message: error instanceof Error ? error.message : 'Unknown network error',
				data: null as any
			}
		}
	}

	// 获取所有节点信息
	async getNodes(): Promise<NodeData[] | 'private'> {
		const response = await this.get<NodeData[]>('/api/nodes')
		// 检查是否为私有状态
		if ('status' in response && response.status === 401) {
			return 'private'
		}
		// 检查是否为成功的 API 响应
		if ('status' in response && response.status === 'success') {
			return (response as ApiResponse<NodeData[]>).data
		}
		// 其他情况返回空数组
		return []
	}

	// 获取指定节点的最近状态
	async getNodeRecentStats(uuid: string): Promise<NodeStats[]> {
		const response = await this.get<NodeStats[]>(`/api/recent/${uuid}`)
		return response.status === 'success' ? response.data : []
	}

	// 获取负载历史记录
	async getLoadHistory(uuid: string, hours: number = 24): Promise<{ count: number; records: HistoryRecord[] } | null> {
		const response = await this.get<{
			count: number
			records: HistoryRecord[]
		}>(`/api/records/load?uuid=${uuid}&hours=${hours}`)
		return response.status === 'success' ? response.data : null
	}

	// 获取 Ping 历史记录
	async getPingHistory(uuid: string, hours: number = 24): Promise<PingHistoryResponse | null> {
		const response = await this.get<PingHistoryResponse>(`/api/records/ping?uuid=${uuid}&hours=${hours}`)
		return response.status === 'success' ? response.data : null
	}

	// 获取公开设置
	async getPublicSettings(): Promise<PublicInfo | null> {
		const response = await this.get<PublicInfo>('/api/public')
		return response.status === 'success' ? response.data : null
	}

	// 获取版本信息
	async getVersion(): Promise<{ version: string; hash: string }> {
		const response = await this.get<{ version: string; hash: string }>('/api/version')
		return response.status === 'success' ? response.data : { version: 'unknown', hash: 'unknown' }
	}

	// 获取用户信息
	async getUserInfo(): Promise<any> {
		const response = await this.get<any>('/api/me')
		return response.status === 'success' ? response.data : null
	}
}

// 创建 API 服务实例
export const apiService = new ApiService()

// WebSocket 连接管理
export class WebSocketService {
	private ws: WebSocket | null = null
	private reconnectAttempts = 0
	private maxReconnectAttempts = 5
	private reconnectInterval = 5000
	private listeners: Set<(data: any) => void> = new Set()
	private url: string
	private statusInterval: ReturnType<typeof setInterval> | null = null

	constructor(url: string = '') {
		this.url = url
	}

	connect() {
		// 如果已有连接，则不重复连接
		if (this.ws && this.ws.readyState < 2) {
			return
		}
		try {
			this.ws = new WebSocket(this.url || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/clients`)

			this.ws.onopen = () => {
				console.log('WebSocket connected')
				this.reconnectAttempts = 0
				// 发送获取数据请求
				this.send('get')
				// 启动定时状态更新
				this.startStatusUpdates()
			}

			this.ws.onmessage = event => {
				try {
					const data = JSON.parse(event.data)
					if (data.status === 'success' && data.data) {
						// 直接将收到的数据传递给监听器
						this.listeners.forEach(listener => listener(data.data))
					}
				} catch (error) {
					console.error('Failed to parse WebSocket message:', error)
				}
			}

			this.ws.onclose = () => {
				console.log('WebSocket disconnected')
				this.stopStatusUpdates()
				this.reconnect()
			}

			this.ws.onerror = error => {
				console.error('WebSocket error:', error)
			}
		} catch (error) {
			console.error('Failed to connect WebSocket:', error)
			this.reconnect()
		}
	}

	private reconnect() {
		if (this.reconnectAttempts < this.maxReconnectAttempts) {
			this.reconnectAttempts++
			console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
			setTimeout(() => this.connect(), this.reconnectInterval)
		} else {
			console.error('Max reconnection attempts reached')
		}
	}

	send(data: string) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(data)
		}
	}

	subscribe(listener: (data: any) => void) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	disconnect() {
		if (this.ws) {
			this.ws.close()
			this.ws = null
			this.stopStatusUpdates()
		}
	}

	private startStatusUpdates() {
		if (this.statusInterval) {
			clearInterval(this.statusInterval)
		}
		this.statusInterval = setInterval(() => {
			this.send('get')
		}, 2000)
	}

	private stopStatusUpdates() {
		if (this.statusInterval) {
			clearInterval(this.statusInterval)
			this.statusInterval = null
		}
	}
}

// 延迟 WebSocket 服务实例的创建
let wsServiceInstance: WebSocketService | null = null

export function getWsService(): WebSocketService {
	if (!wsServiceInstance) {
		wsServiceInstance = new WebSocketService()
	}
	return wsServiceInstance
}
