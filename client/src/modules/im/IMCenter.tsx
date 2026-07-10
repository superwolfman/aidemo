import { useEffect, useState } from 'react';
import { Bot, Send, UserRound } from 'lucide-react';
import { Header, Status } from '../../components/ui';
import { realtime } from '../../platform/realtime';

type Message = {
  id: string;
  from: string;
  to: string;
  text: string;
  createdAt: string;
};

export default function IMCenter() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'seed-1',
      from: 'client',
      to: 'ops-center',
      text: '客户咨询活动优惠券是否可以叠加使用？',
      createdAt: new Date().toISOString()
    },
    {
      id: 'seed-2',
      from: 'robot',
      to: 'client',
      text: '机器人已接入，会先根据知识库和活动规则回复，并支持转人工。',
      createdAt: new Date().toISOString()
    }
  ]);
  const [text, setText] = useState('客户问收益能不能保证，怎么回复？');

  useEffect(() => {
    realtime.subscribe('im');
    const off = realtime.on('im:message', (payload) => {
      setMessages((items) => [...items, payload].slice(-30));
    });
    return off;
  }, []);

  function sendMessage(from: 'client' | 'ops-center') {
    if (!text.trim()) return;
    realtime.send('im:message', {
      from,
      to: from === 'client' ? 'ops-center' : 'client',
      text
    });
    setText('');
  }

  return (
    <section>
      <Header
        title="中台 / 客户端在线 IM"
        desc="WebSocket 长连接承载客户端咨询、中台坐席回复、机器人自动应答和转人工信号，适合企微/H5/PC 多端统一会话。"
        action={<Status status="ws-live" />}
      />

      <div className="im-layout">
        <section className="panel im-chat-panel">
          <div className="im-message-list">
            {messages.map((message) => (
              <div key={message.id} className={`im-message ${message.from}`}>
                <div className="im-avatar">{message.from === 'robot' ? <Bot size={16} /> : <UserRound size={16} />}</div>
                <div>
                  <span>{message.from} · {new Date(message.createdAt).toLocaleTimeString()}</span>
                  <p>{message.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="chat-input">
            <input value={text} onChange={(event) => setText(event.target.value)} />
            <button className="primary-button" onClick={() => sendMessage('client')}><Send size={16} />客户端发送</button>
            <button className="secondary-button" onClick={() => sendMessage('ops-center')}>中台回复</button>
          </div>
        </section>

        <section className="panel">
          <h2>会话治理</h2>
          <div className="list">
            <div className="list-item"><strong>机器人接待</strong><span>常见问题自动回复</span></div>
            <div className="list-item"><strong>转人工</strong><span>投诉、风险、低置信度触发人工</span></div>
            <div className="list-item"><strong>会话审计</strong><span>消息写入 MongoDB im_messages</span></div>
            <div className="list-item"><strong>多端一致</strong><span>PC/H5/企微共用 employeeId 和 conversationId</span></div>
          </div>
        </section>
      </div>
    </section>
  );
}
