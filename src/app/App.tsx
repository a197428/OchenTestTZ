import { ru } from './i18n';
import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{ru.appTitle}</h1>
          <p className={styles.subtitle}>{ru.appSubtitle}</p>
        </div>
        <span className={styles.badge}>{ru.phaseBadge}</span>
      </header>

      <main className={styles.main}>
        <section className={`${styles.panel} ${styles.status}`}>
          <h2 className={styles.panelTitle}>{ru.statusTitle}</h2>
          <p className={styles.panelText}>{ru.statusBody}</p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{ru.sourcesTitle}</h2>
          <p className={styles.panelText}>{ru.sourcesHint}</p>
          <ul className={styles.list}>
            {ru.sources.map((source) => (
              <li key={source.path} className={styles.item}>
                <code className={styles.path}>{source.path}</code>
                <span className={styles.note}>{source.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{ru.tipsTitle}</h2>
          <ul className={styles.tips}>
            {ru.tips.map((tip) => (
              <li key={tip} className={styles.tip}>
                {tip}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className={styles.footer}>{ru.footer}</footer>
    </div>
  );
}
