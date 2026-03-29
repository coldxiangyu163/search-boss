function buildDownloadWriteContractPrompt() {
  return '回写格式固定：附件发现/下载都用 run-attachment，下载完成后再写 run-action(resume_downloaded)；优先补偿 pending/failed callback，避免盲目重下。';
}

module.exports = {
  buildDownloadWriteContractPrompt
};
