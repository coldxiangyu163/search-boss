# Browser Runtime Console Design

## Design thesis
This surface should feel like an operator cockpit, not a generic admin modal. The browser is the scene of action; the status rail is the operator's judgment layer. Mature product quality here means calm focus: fewer panels, clearer hierarchy, faster judgment.

## Aesthetic direction
- **Mood:** midnight control deck inside an otherwise light admin product
- **Contrast strategy:** the modal becomes darker and more immersive than the surrounding app so the user immediately understands they entered a live operational context
- **Hierarchy:** browser as stage, control rail as precision instrument panel
- **Signature moment:** browser-focus mode, where the live page stretches wide while the control rail compresses into a slim contextual column

## Layout
- Fullscreen-grade overlay shell
- Left/primary panel: browser frame, title, current page status, intervention hint, focus button
- Right/secondary rail: current run badge, task label, stage summary, latest event, action buttons, expandable detailed logs
- In idle mode, reuse the same shell but swap the run-specific cards for “当前暂无执行任务 / 最近一次运行信息” copy

## Behavior
- Logs default collapsed
- If the task is stoppable and active, show stop prominently in the control rail
- Restart browser remains available but visually secondary to run-state decisions
- Focus/fullscreen browser toggle is reversible and never hides the escape route back to the full console

## Copy guidance
Avoid engineering-heavy language. Prefer operator language such as:
- 当前任务
- 当前阶段
- 建议操作
- 已进入人工处理视图
- 当前暂无执行任务
- 如页面异常，可直接点击画面处理
