'use strict';

const REPOSITORY_URL = 'https://github.com/kevin-kuantso/work-motivator';

function labels(locale) {
  return locale === 'CN'
    ? { title: '关于上班鼓励器', open: '打开 GitHub 项目', version: '版本', privacy: '无需帐号，设置只保存在本机。' }
    : { title: '關於上班鼓勵器', open: '開啟 GitHub 專案', version: '版本', privacy: '免帳號，設定只保存在本機。' };
}

function aboutText(version, locale) {
  const t = labels(locale);
  return `${t.version} ${version}\n${t.privacy}\n\nGitHub: ${REPOSITORY_URL}`;
}

function aboutInfo(version, locale) {
  const t = labels(locale);
  return { title: t.title, open: t.open, detail: aboutText(version, locale) };
}

module.exports = { REPOSITORY_URL, aboutText, aboutInfo };
