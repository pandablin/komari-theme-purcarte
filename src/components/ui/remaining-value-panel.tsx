import React from 'react'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'
import { Button } from './button'
import { Copy, Check, X } from 'lucide-react'
import { currencyMap } from '@/services/exchangeRate'

interface RemainingValuePanelProps {
	price: number
	currency: string
	billingCycle: number
	expiredAt: string | null
	transactionDate?: string | null
}

const mapCycleToDays = (billingCycle: number) => {
	if (billingCycle >= 28 && billingCycle <= 31) return { days: 30, label: '月付', unit: '月' }
	if (billingCycle >= 89 && billingCycle <= 92) return { days: 90, label: '季付', unit: '季' }
	if (billingCycle >= 180 && billingCycle <= 184) return { days: 180, label: '半年付', unit: '半年' }
	if (billingCycle >= 364 && billingCycle <= 366) return { days: 365, label: '年付', unit: '年' }
	return { days: Math.max(1, billingCycle), label: `${billingCycle}天`, unit: `${billingCycle}天` }
}

export const RemainingValuePanel: React.FC<RemainingValuePanelProps> = ({ price, currency, billingCycle, expiredAt }) => {
	const { formatCurrencyWithConversion, formatPriceWithConversion, convertCurrency, currentCurrency } = useExchangeRate()

	// 以本地时区的 00:00 计算日期差
	const now = new Date()
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

	const billDisplay = formatPriceWithConversion(price, currency, billingCycle)

	const cycle = mapCycleToDays(billingCycle)

	// 剩余天数 floor((到期00:00 - 今天00:00)/天)
	const remainingDays = React.useMemo(() => {
		if (!expiredAt) return 0
		const end = new Date(expiredAt)
		const expiryStart = new Date(end.getFullYear(), end.getMonth(), end.getDate())
		const msPerDay = 24 * 60 * 60 * 1000
		const raw = Math.floor((expiryStart.getTime() - todayStart.getTime()) / msPerDay)
		return Math.max(0, raw)
	}, [expiredAt, todayStart])

	const remainingMonths = Math.floor(remainingDays / 30)

	// 剩余价值 = 价格 / 周期基准天数 * 剩余天数（在原币种里算），展示时再转换
	const remainingValue = (price / cycle.days) * remainingDays
	const displayRemaining = formatCurrencyWithConversion(remainingValue, currency, undefined, { showSymbol: true, decimalPlaces: 3 })

	// 汇率（将 1 原货币 -> 当前显示货币）
	const rate = convertCurrency(1, currency, currentCurrency)

	const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
	const formatStamp = (d: Date) =>
		`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
			d.getSeconds()
		).padStart(2, '0')}`

	const zhCurrency = currencyMap[currency]

	const exportText = `\`\`\`markdown
## 剩余价值计算器

### 输入参数
- 参考汇率: ${rate.toFixed(3)}
- 外币汇率: ${rate.toFixed(3)}
- 续费金额: ${price.toFixed(2)} ${currency} ${zhCurrency ? `(${zhCurrency})` : ''}
- 付款周期: ${cycle.label}
- 到期时间: ${expiredAt ? formatDate(new Date(expiredAt)) : '-'}
- 交易日期: ${formatDate(todayStart)}

### 计算结果
- 交易日期: ${formatDate(todayStart)}
- 外币汇率: ${rate.toFixed(3)}
- 续费价格: ${price.toFixed(3)} ${currency}/${cycle.unit}
- 剩余天数: ${remainingDays} 天 (于 ${expiredAt ? formatDate(new Date(expiredAt)) : '-'} 过期)
- 剩余价值: ${remainingValue.toFixed(3)} ${currency} (总 ${remainingValue.toFixed(3)} ${currency})

*导出时间: ${formatStamp(new Date())}*
\`\`\`
`

	const [copyStatus, setCopyStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
	const resetCopyStatusLater = () => setTimeout(() => setCopyStatus('idle'), 2000)

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(exportText)
			setCopyStatus('success')
			resetCopyStatusLater()
		} catch {
			try {
				const item = new ClipboardItem({ 'text/plain': new Blob([exportText], { type: 'text/plain' }) })
				await navigator.clipboard.write([item])
				setCopyStatus('success')
				resetCopyStatusLater()
			} catch (err) {
				console.warn('复制失败，请手动复制：', err)
				setCopyStatus('error')
				resetCopyStatusLater()
			}
		}
	}

	return (
		<div className="flex flex-col gap-2 select-text">
			<div className="flex items-center justify-between">
				<div className="text-base font-semibold">剩余价值计算面板</div>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="secondary" onClick={handleCopy} title="复制文本">
						{copyStatus === 'success' ? (
							<Check className="size-4 text-green-600" />
						) : copyStatus === 'error' ? (
							<X className="size-4 text-red-600" />
						) : (
							<Copy className="size-4" />
						)}
						复制
					</Button>
				</div>
			</div>
			<div className="text-sm">
				<div className="flex justify-between">
					<span>交易日期</span>
					<span>{todayStart.toISOString().slice(0, 10)}</span>
				</div>
				<div className="flex justify-between">
					<span>到期时间</span>
					<span>{expiredAt ? new Date(expiredAt).toISOString().slice(0, 10) : '—'}</span>
				</div>
				<div className="flex justify-between">
					<span>账单金额</span>
					<span>{billDisplay}</span>
				</div>
				<div className="flex justify-between">
					<span>计算周期</span>
					<span>
						{cycle.label}（{cycle.days} 天）
					</span>
				</div>
				<div className="flex justify-between">
					<span>剩余月份</span>
					<span>{remainingMonths} 个月</span>
				</div>
				<div className="flex justify-between">
					<span>剩余天数</span>
					<span>{remainingDays} 天</span>
				</div>
				<div className="flex justify-between font-semibold">
					<span>剩余价值</span>
					<span className="text-(--accent-11)">{displayRemaining}</span>
				</div>
			</div>
		</div>
	)
}
