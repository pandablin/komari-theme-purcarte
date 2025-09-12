import { useState, useMemo, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { StatsBar } from '@/components/sections/StatsBar'
import { NodeCard } from '@/components/sections/NodeCard'
import { NodeListHeader } from '@/components/sections/NodeListHeader'
import { NodeListItem } from '@/components/sections/NodeListItem'
import Loading from '@/components/loading'
import type { NodeWithStatus } from '@/types/node'
import { useNodeData } from '@/contexts/NodeDataContext'
import { useLiveData } from '@/contexts/LiveDataContext'
import { useAppConfig } from '@/config'
import { useTheme } from '@/hooks/useTheme'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'

interface HomePageProps {
	searchTerm: string
	setSearchTerm: (term: string) => void
}

const homeStateCache = {
	selectedGroup: '所有',
	scrollPosition: 0
}

const HomePage: React.FC<HomePageProps> = ({ searchTerm, setSearchTerm }) => {
	const { viewMode, statusCardsVisibility, setStatusCardsVisibility } = useTheme()
	const { nodes: staticNodes, loading, getGroups } = useNodeData()
	const { liveData } = useLiveData()
	const [selectedGroup, setSelectedGroup] = useState(homeStateCache.selectedGroup)
	const { enableGroupedBar, enableStatsBar, enableSwap, enableListItemProgressBar, selectTrafficProgressStyle } = useAppConfig()
	const { convertCurrency, calculateMonthlyRenewalWithConversion } = useExchangeRate()
	const combinedNodes = useMemo<NodeWithStatus[]>(() => {
		if (!staticNodes || staticNodes === 'private') return []
		return staticNodes.map(node => {
			const isOnline = liveData?.online.includes(node.uuid) ?? false
			const stats = isOnline ? liveData?.data[node.uuid] : undefined

			return {
				...node,
				status: isOnline ? 'online' : 'offline',
				stats: stats
			}
		})
	}, [staticNodes, liveData])

	const groups = useMemo(() => ['所有', ...getGroups()], [getGroups])

	const filteredNodes = useMemo(() => {
		return combinedNodes
			.filter((node: NodeWithStatus) => selectedGroup === '所有' || node.group === selectedGroup)
			.filter((node: NodeWithStatus) => node.name.toLowerCase().includes(searchTerm.toLowerCase()))
	}, [combinedNodes, selectedGroup, searchTerm])

	const stats = useMemo(() => {
		return {
			onlineCount: filteredNodes.filter(n => n.status === 'online').length,
			totalCount: filteredNodes.length,
			uniqueRegions: new Set(filteredNodes.map(n => n.region)).size,
			totalTrafficUp: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.totalUp || 0), 0),
			totalTrafficDown: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.totalDown || 0), 0),
			currentSpeedUp: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.up || 0), 0),
			currentSpeedDown: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.down || 0), 0)
		}
	}, [filteredNodes])

	// 金额/账单统计（保持在 Home 侧 useMemo 计算）
	const billing = useMemo(() => {
		if (!filteredNodes || filteredNodes.length === 0) {
			return {
				monthlyTotal: 0,
				monthlyRemaining: 0,
				nodesSumPrice: 0,
				nodesRemainingYear: 0,
				monthlyPerNode: [] as { name: string; amount: number }[],
				nodesPriceList: [] as { name: string; amount: number }[],
				monthlyEvents: [] as { name: string; date: Date; amount: number }[],
				yearPerNode: [] as { name: string; amount: number }[]
			}
		}

		const now = new Date()
		const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
		const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)

		// 辅助：在区间内累计续费，并返回事件明细
		const buildRenewalSummary = (start: Date, end: Date) => {
			const startMs = start.getTime()
			const endMs = end.getTime()
			let total = 0
			const events: { name: string; date: Date; amount: number }[] = []
			for (const n of filteredNodes) {
				const { price, billing_cycle, currency, expired_at, name } = n
				if (!price || price <= 0) continue
				if (!billing_cycle || billing_cycle <= 0) continue
				if (!expired_at) continue
				const base = new Date(expired_at)
				let baseMs = base.getTime()
				const periodMs = billing_cycle * 24 * 60 * 60 * 1000
				if (Number.isNaN(baseMs) || !Number.isFinite(periodMs) || periodMs <= 0) continue
				if (baseMs < startMs) {
					const k = Math.floor((startMs - baseMs) / periodMs) + 1
					baseMs = baseMs + k * periodMs
				}
				for (let t = baseMs; t <= endMs; t += periodMs) {
					const converted = convertCurrency(price, currency)
					total += converted
					events.push({ name, date: new Date(t), amount: converted })
				}
			}
			events.sort((a, b) => a.date.getTime() - b.date.getTime())
			return { total, events }
		}

		// 1) 月付金额 第一行：节点折算为30天合计
		const monthlyTotal = filteredNodes.reduce((acc, n) => acc + calculateMonthlyRenewalWithConversion(n.price, n.currency, n.billing_cycle), 0)

		// 1) 月付金额 第二行：本月区间续费
		const { total: monthlyRemaining, events: monthlyEvents } = buildRenewalSummary(now, endOfMonth)

		// 2) 节点总金额 第一行：节点标价按当前货币合计
		const nodesSumPrice = filteredNodes.reduce((acc, n) => (n.price && n.price > 0 ? acc + convertCurrency(n.price, n.currency) : acc), 0)

		// 2) 节点总金额 第二行：年内区间续费（聚合）
		const { total: nodesRemainingYear, events: yearEvents } = buildRenewalSummary(now, endOfYear)
		const yearAggMap = yearEvents.reduce<Record<string, { name: string; amount: number }>>((acc, evt) => {
			acc[evt.name] = acc[evt.name] ? { name: evt.name, amount: acc[evt.name].amount + evt.amount } : { name: evt.name, amount: evt.amount }
			return acc
		}, {})
		const yearPerNode = Object.values(yearAggMap).sort((a, b) => b.amount - a.amount)

		// 明细：按节点月费、节点标价
		const monthlyPerNode = filteredNodes
			.map(n => ({ name: n.name, amount: calculateMonthlyRenewalWithConversion(n.price, n.currency, n.billing_cycle) }))
			.sort((a, b) => b.amount - a.amount)
		const nodesPriceList = filteredNodes
			.filter(n => n.price && n.price > 0)
			.map(n => ({ name: n.name, amount: convertCurrency(n.price, n.currency) }))
			.sort((a, b) => b.amount - a.amount)

		return {
			monthlyTotal,
			monthlyRemaining,
			nodesSumPrice,
			nodesRemainingYear,
			monthlyPerNode,
			nodesPriceList,
			monthlyEvents,
			yearPerNode
		}
	}, [filteredNodes, convertCurrency, calculateMonthlyRenewalWithConversion])

	const mainContentRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleScroll = () => {
			if (mainContentRef.current) {
				homeStateCache.scrollPosition = mainContentRef.current.scrollTop
			}
		}

		const mainContentElement = mainContentRef.current
		mainContentElement?.addEventListener('scroll', handleScroll)

		return () => {
			mainContentElement?.removeEventListener('scroll', handleScroll)
		}
	}, [])

	useEffect(() => {
		if (mainContentRef.current) {
			mainContentRef.current.scrollTop = homeStateCache.scrollPosition
		}
	}, [loading])

	useEffect(() => {
		homeStateCache.selectedGroup = selectedGroup
	}, [selectedGroup])

	return (
		<div ref={mainContentRef} className="w-[90%] max-w-screen-2xl mx-auto flex-1 flex flex-col pb-10 overflow-y-auto">
			{enableStatsBar && (
				<StatsBar
					displayOptions={statusCardsVisibility}
					setDisplayOptions={setStatusCardsVisibility}
					stats={stats}
					loading={loading}
					nodes={filteredNodes}
					billing={billing}
				/>
			)}

			<main className="flex-1 px-4 pb-4">
				{enableGroupedBar && (
					<div className="flex purcarte-blur theme-card-style overflow-auto whitespace-nowrap overflow-x-auto items-center min-w-[300px] text-secondary-foreground space-x-4 px-4 mb-4">
						<span>分组</span>
						{groups.map((group: string) => (
							<Button key={group} variant={selectedGroup === group ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedGroup(group)}>
								{group}
							</Button>
						))}
					</div>
				)}

				<div className="space-y-4 mt-4">
					{loading ? (
						<Loading text="正在努力获取数据中..." />
					) : filteredNodes.length > 0 ? (
						<div className={viewMode === 'grid' ? '' : 'space-y-2 overflow-auto purcarte-blur theme-card-style p-2'}>
							<div className={viewMode === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4' : 'min-w-[1080px]'}>
								{viewMode === 'table' && <NodeListHeader enableSwap={enableSwap} />}
								{filteredNodes.map((node: NodeWithStatus) =>
									viewMode === 'grid' ? (
										<NodeCard key={node.uuid} node={node} enableSwap={enableSwap} selectTrafficProgressStyle={selectTrafficProgressStyle} />
									) : (
										<NodeListItem
											key={node.uuid}
											node={node}
											enableSwap={enableSwap}
											enableListItemProgressBar={enableListItemProgressBar}
											selectTrafficProgressStyle={selectTrafficProgressStyle}
										/>
									)
								)}
							</div>
						</div>
					) : (
						<div className="flex flex-grow items-center justify-center">
							<Card className="w-full max-w-md">
								<CardHeader>
									<CardTitle className="text-2xl font-bold">Not Found</CardTitle>
									<CardDescription>请尝试更改筛选条件</CardDescription>
								</CardHeader>
								<CardFooter>
									<Button onClick={() => setSearchTerm('')} className="w-full">
										清空搜索
									</Button>
								</CardFooter>
							</Card>
						</div>
					)}
				</div>
			</main>
		</div>
	)
}

export default HomePage
