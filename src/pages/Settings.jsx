import { motion } from 'framer-motion';
import { Server, Crown, Sparkles, Cube } from '../icons';
import { useState, useEffect } from 'react';
import { useStore } from '../components/StoreProvider';
import { showSuccess, showError } from '../utils/toast';

// 根据 API 类型自动补全完整请求 URL
const resolveApiUrl = (baseUrl, apiType) => {
    const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
    if (trimmed.includes('/chat/completions') || trimmed.endsWith('/messages')) {
        return trimmed;
    }
    const suffix = apiType === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
    return `${trimmed}${suffix}`;
};

// 添加测试函数。失败时抛出的 Error 会带 `.details` 字段，包含完整诊断信息。
const testOpenAIConnection = async (apiKey, baseUrl, modelName, apiType = 'openai') => {
    const fullUrl = resolveApiUrl(baseUrl, apiType);
    const startedAt = Date.now();

    let headers, body;
    if (apiType === 'anthropic') {
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        };
    } else {
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };
    }
    body = JSON.stringify({
        model: modelName,
        messages: [
            {
                role: "user",
                content: "Hello, this is a test message. Please reply with 'OK' if you receive this."
            }
        ],
        max_tokens: 10
    });

    // 屏蔽密钥用于诊断展示
    const maskedHeaders = { ...headers };
    if (maskedHeaders.Authorization) {
        maskedHeaders.Authorization = `Bearer ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
    }
    if (maskedHeaders['x-api-key']) {
        maskedHeaders['x-api-key'] = `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
    }

    const baseDetails = {
        request: {
            url: fullUrl,
            method: 'POST',
            apiType,
            headers: maskedHeaders,
            bodyPreview: body
        }
    };

    let response;
    try {
        response = await fetch(fullUrl, { method: 'POST', headers, body });
    } catch (e) {
        // 网络层错误（CORS、DNS、SSL、未连接……）通常没有 response
        const err = new Error(`API测试失败：网络层错误 - ${e.message || e.name}`);
        err.details = {
            ...baseDetails,
            elapsedMs: Date.now() - startedAt,
            errorType: e.name || 'Error',
            errorMessage: e.message || String(e),
            errorStack: e.stack || null,
            hint: '常见原因：1) Tauri webview 的 CORS 限制；2) URL 错误或域名解析失败；3) HTTPS 证书问题；4) 防火墙/代理拦截。建议改用后端发请求。'
        };
        throw err;
    }

    // 拿到响应 -> 先以文本形式读取，再尝试 JSON 解析（防止响应不是 JSON 时丢失信息）
    const rawText = await response.text();
    let data = null;
    let parseError = null;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
        parseError = e.message;
    }

    const responseInfo = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        bodyPreview: rawText.length > 2000 ? rawText.slice(0, 2000) + '...(truncated)' : rawText,
        parseError
    };

    if (!response.ok) {
        const apiMsg = data?.error?.message || data?.message || rawText.slice(0, 200);
        const err = new Error(`API测试失败：HTTP ${response.status} - ${apiMsg}`);
        err.details = { ...baseDetails, elapsedMs: Date.now() - startedAt, response: responseInfo };
        throw err;
    }

    if (data?.error) {
        const err = new Error(`API测试失败：${data.error.message || '未知错误'}`);
        err.details = { ...baseDetails, elapsedMs: Date.now() - startedAt, response: responseInfo };
        throw err;
    }

    const success = apiType === 'anthropic'
        ? !!(data?.content?.[0]?.text)
        : !!(data?.choices?.[0]?.message);

    if (!success) {
        const err = new Error('API测试失败：响应格式不正确');
        err.details = { ...baseDetails, elapsedMs: Date.now() - startedAt, response: responseInfo };
        throw err;
    }

    return { ok: true, details: { ...baseDetails, elapsedMs: Date.now() - startedAt, response: responseInfo } };
};

const MODEL_OPTIONS = [
    {
        id: 'deepseek',
        name: 'DeepSeek',
        modelName: 'deepseek-chat'
    },
    {
        id: 'deepseek-R1',
        name: 'DeepSeek R1',
        modelName: 'deepseek-reasoner'
    },
    {
        id: 'stepfun',
        name: '阶跃星辰',
        modelName: 'step-2-16k'
    },
    {
        id: 'custom',
        name: '自定义模型',
        modelName: 'custom'
    }
];

export default function Settings() {
    const { settings, updateSettings } = useStore();
    const [activeModel, setActiveModel] = useState(settings?.model_type || 'deepseek');
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    // testResult: { ok: boolean, message: string, details: object } | null
    const [testResult, setTestResult] = useState(null);

    useEffect(() => {
        if (settings?.model_type) {
            setActiveModel(settings.model_type);
        }
    }, [settings?.model_type]);

    const handleModelChange = async (model) => {
        setActiveModel(model);
        await updateSettings({ model_type: model });
    };

    return (
        <div className="h-full flex flex-col gap-6">
            {/* 头部介绍区域 */}
            <motion.div
                className="w-full bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-zinc-200 dark:border-zinc-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)] backdrop-blur-sm"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-4">AI模型设置</h1>
                <p className="text-zinc-600 dark:text-zinc-400">
                    管理您的API配置和订阅信息。
                </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 模型选择卡片 */}
                <motion.div
                    className="flex flex-col bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-zinc-200 dark:border-zinc-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)] backdrop-blur-sm"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className="flex items-center gap-3 text-sm text-zinc-500 mb-6">
                        <Crown className="w-5 h-5 stroke-zinc-500" />
                        模型选择
                    </div>
                    <div className="space-y-3">
                        {MODEL_OPTIONS.map((model) => (
                            <button
                                key={model.id}
                                onClick={() => handleModelChange(model.id)}
                                className="w-full flex items-center justify-between p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{model.name}</span>
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md">
                                        <Cube className="w-3.5 h-3.5 stroke-zinc-500" />
                                        <span className="text-xs text-zinc-500">{model.modelName}</span>
                                    </div>
                                    {model.id.includes('deepseek') && (
                                        <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                                            <Sparkles className="w-3.5 h-3.5 stroke-blue-500" />
                                            <span className="text-xs text-blue-500">硅基流动</span>
                                        </div>
                                    )}
                                </div>
                                <div className={`w-4 h-4 rounded-full border transition-all ${activeModel === model.id
                                    ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_2px_0_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_1px_2px_0_rgba(255,255,255,0.1)]'
                                    : 'border-zinc-300 dark:border-zinc-600'
                                    }`} />
                            </button>
                        ))}
                    </div>
                </motion.div>

                {/* 自定义API配置卡片 */}
                <motion.div
                    className="flex flex-col bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-zinc-200 dark:border-zinc-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)] backdrop-blur-sm"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="flex items-center gap-3 text-sm text-zinc-500 mb-6">
                        <Server className="w-5 h-5 stroke-zinc-500" />
                        自定义API配置
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-zinc-500 mb-2">API 类型</label>
                            <select
                                disabled={activeModel !== 'custom'}
                                value={settings?.custom_model?.api_type || 'openai'}
                                onChange={(e) => updateSettings({
                                    custom_model: {
                                        ...settings?.custom_model,
                                        api_type: e.target.value
                                    }
                                })}
                                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <option value="openai">OpenAI 兼容 (openai)</option>
                                <option value="anthropic">Anthropic (Claude)</option>
                                <option value="opencode-go">OpenCode Go</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-500 mb-2">API Key</label>
                            <input
                                type="text"
                                disabled={activeModel !== 'custom'}
                                value={settings?.custom_model?.auth || ''}
                                onChange={(e) => updateSettings({
                                    custom_model: {
                                        ...settings?.custom_model,
                                        auth: e.target.value
                                    }
                                })}
                                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="输入你的API Key"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-500 mb-2">Base URL</label>
                            <input
                                type="text"
                                disabled={activeModel !== 'custom'}
                                value={settings?.custom_model?.api_url || ''}
                                onChange={(e) => updateSettings({
                                    custom_model: {
                                        ...settings?.custom_model,
                                        api_url: e.target.value
                                    }
                                })}
                                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="例如：https://hk.routeai.cc （路径将根据API类型自动补全）"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-500 mb-2">Model Name</label>
                            <input
                                type="text"
                                disabled={activeModel !== 'custom'}
                                value={settings?.custom_model?.model_name || ''}
                                onChange={(e) => updateSettings({
                                    custom_model: {
                                        ...settings?.custom_model,
                                        model_name: e.target.value
                                    }
                                })}
                                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="例如：gpt-3.5-turbo"
                            />
                        </div>
                        <div className="pt-2 flex items-center justify-between">
                            <p className="text-xs text-zinc-400">
                                {activeModel === 'custom' ? '请填写完整的API配置信息' : '选择自定义模型以启用配置'}
                            </p>
                            {activeModel === 'custom' && (
                                <button
                                    onClick={async () => {
                                        if (!settings?.custom_model?.auth) {
                                            showError('请输入API Key');
                                            return;
                                        }
                                        if (!settings?.custom_model?.api_url) {
                                            showError('请输入API地址');
                                            return;
                                        }
                                        if (!settings?.custom_model?.model_name) {
                                            showError('请输入模型名称');
                                            return;
                                        }

                                        setIsTestingConnection(true);
                                        setTestResult(null);
                                        try {
                                            const result = await testOpenAIConnection(
                                                settings.custom_model.auth,
                                                settings.custom_model.api_url,
                                                settings.custom_model.model_name,
                                                settings.custom_model.api_type
                                            );
                                            if (result?.ok) {
                                                showSuccess('API连接测试成功！');
                                                setTestResult({ ok: true, message: 'API连接测试成功', details: result.details });
                                            }
                                        } catch (error) {
                                            showError(error.message);
                                            setTestResult({ ok: false, message: error.message, details: error.details || { errorMessage: error.message, errorStack: error.stack } });
                                        } finally {
                                            setIsTestingConnection(false);
                                        }
                                    }}
                                    disabled={isTestingConnection}
                                    className={`px-3 py-1.5 text-xs text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-lg transition-all flex items-center gap-2
                                        ${isTestingConnection
                                            ? 'opacity-70 cursor-not-allowed'
                                            : 'hover:bg-zinc-800 dark:hover:bg-zinc-200'}`}
                                >
                                    {isTestingConnection ? (
                                        <>
                                            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                                <circle
                                                    className="opacity-25"
                                                    cx="12"
                                                    cy="12"
                                                    r="10"
                                                    stroke="currentColor"
                                                    strokeWidth="4"
                                                    fill="none"
                                                />
                                                <path
                                                    className="opacity-75"
                                                    fill="currentColor"
                                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                />
                                            </svg>
                                            测试中...
                                        </>
                                    ) : (
                                        '测试连接'
                                    )}
                                </button>
                            )}
                        </div>
                        {/* 测试详情面板 */}
                        {activeModel === 'custom' && testResult && (
                            <div className={`mt-3 rounded-lg border text-xs ${testResult.ok
                                ? 'border-green-200 bg-green-50 dark:bg-green-900/10 dark:border-green-900/40'
                                : 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-900/40'
                                }`}>
                                <div className="flex items-center justify-between px-3 py-2 border-b border-inherit">
                                    <span className={`font-medium ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={async () => {
                                                const text = JSON.stringify(testResult.details, null, 2);
                                                try {
                                                    await navigator.clipboard.writeText(text);
                                                    showSuccess('已复制详情');
                                                } catch {
                                                    showError('复制失败，请手动选择文本');
                                                }
                                            }}
                                            className="px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-white/50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-300"
                                        >
                                            复制详情
                                        </button>
                                        <button
                                            onClick={() => setTestResult(null)}
                                            className="px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-white/50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-300"
                                        >
                                            关闭
                                        </button>
                                    </div>
                                </div>
                                <pre className="px-3 py-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-zinc-700 dark:text-zinc-300 font-mono leading-relaxed">
{JSON.stringify(testResult.details, null, 2)}
                                </pre>
                                {!testResult.ok && testResult.details?.hint && (
                                    <div className="px-3 py-2 border-t border-inherit text-zinc-500 dark:text-zinc-400">
                                        💡 {testResult.details.hint}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>
        </div>
    );
} 