<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSettingsStore, themes, fonts, customFonts } from '@/stores/settings'
import { getCover } from '@/utils/helpers'
import { ElMessage, ElMessageBox, ElColorPicker, ElScrollbar, ElSlider } from 'element-plus'
import type { ReadConfig } from '@/api/types'
import { ttsVoiceList } from '@/plugins/ttsVoices'

const props = withDefaults(defineProps<{
  visible: boolean
  currentBookName?: string
  apiRoot?: string
}>(), { visible: false })

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'save-config', config: ReadConfig): void
  (e: 'close'): void
}>()

const { config, customConfigList, setConfig, setNightTheme, setCustomConfig, addCustomConfig } = useSettingsStore()
const settingsStore = useSettingsStore()

const localConfig = ref<ReadConfig>({ ...config })
const activeTab = ref('theme')
const showCustomColor = ref(false)
const customConfigName = ref('')
const showSaveCustom = ref(false)
const speechConfig = ref({ ...config.speechVoiceConfig || { ttsType: 'local', cacheTTSAudio: false, voiceName: '', speechRate: 1, speechPitch: 1 } })
const selectedDialect = ref('全部')

const ttsTypes = [
  { label: '本地浏览器', value: 'local' },
  { label: 'Edge TTS', value: 'edge' },
  { label: 'HttpTTS', value: 'httpTTS' },
]

const edgeDialects = computed(() => {
  const ds = new Set<string>()
  ttsVoiceList.forEach(v => ds.add(v.dialect))
  return ['全部', ...Array.from(ds).sort()]
})

const localVoiceOptions = computed(() => {
  if (typeof window === 'undefined') return []
  try {
    return (window.speechSynthesis?.getVoices?.() || []).map((v: SpeechSynthesisVoice) => ({ name: v.name, LocalName: v.name }))
  } catch { return [] }
})

const displayTheme = computed(() => {
  const idx = typeof localConfig.value.theme === 'number' ? localConfig.value.theme : 0
  return themes[idx] || themes[0]
})

const isCustomTheme = computed(() => localConfig.value.theme === 'custom')

const dialogTitle = computed(() => {
  return props.currentBookName ? `${props.currentBookName} - 阅读设置` : '阅读设置'
})

const nightThemes = computed(() => themes.slice(0, 7))
const dayThemes = computed(() => themes.slice(0, 7))

function handleClose() {
  setConfig(localConfig.value)
  settingsStore.setSpeechVoiceConfig({ ...speechConfig.value })
  emit('close')
}

function applyTheme(themeIndex: number) {
  localConfig.value = {
    ...localConfig.value,
    theme: themeIndex,
    themeType: themeIndex === 6 ? 'night' : 'day',
    bodyColor: themes[themeIndex].body,
    contentColor: themes[themeIndex].content,
    popupColor: themes[themeIndex].popup,
  }
}

function toggleNightMode() {
  localConfig.value = {
    ...localConfig.value,
    ...customConfigList.find(c => c.configDefaultType === '黑夜默认')!,
    themeType: 'night',
  }
}

function toggleDayMode() {
  localConfig.value = {
    ...localConfig.value,
    ...customConfigList.find(c => c.configDefaultType === '白天默认')!,
    themeType: 'day',
  }
}

function saveCustomConfig() {
  if (!customConfigName.value.trim()) {
    ElMessage.warning('请输入方案名称')
    return
  }
  const newConfig: ReadConfig = {
    name: customConfigName.value,
    customConfig: customConfigName.value,
    configDefaultType: '自定义',
    ...localConfig.value,
  }
  addCustomConfig(newConfig)
  ElMessage.success('保存为自定义方案成功')
  showSaveCustom.value = false
  customConfigName.value = ''
}

function selectCustomConfig(name: string) {
  setCustomConfig(name)
  localConfig.value = { ...config }
}

const tabs = [
  { key: 'theme', label: '阅读主题' },
  { key: 'font', label: '字体设置' },
  { key: 'speech', label: '语音设置' },
  { key: 'paragraph', label: '段落设置' },
  { key: 'custom', label: '自定义方案' },
]

const readModes = [
  { label: '分页', value: '分页' },
  { label: '上下滑动', value: '上下滑动' },
  { label: '左右滑动', value: '左右滑动' },
  { label: '自动阅读', value: '自动阅读' },
]

const clickMethods = [
  { label: '自动', value: '自动' },
  { label: '无', value: '无' },
  { label: '单击滚动', value: '单击滚动' },
  { label: '双击滚动', value: '双击滚动' },
]

const pageModes = [
  { label: '自适应', value: '自适应' },
  { label: '正常', value: '正常' },
  { label: 'Kindle', value: 'Kindle' },
]

const epubModes = [
  { label: 'iframe 模式', value: 'iframe' },
  { label: 'DOM 模式', value: 'dom' },
]

const selectionActions = [
  { label: '操作弹窗', value: '操作弹窗' },
  { label: '复制', value: '复制' },
  { label: '搜索', value: '搜索' },
  { label: '朗读', value: '朗读' },
  { label: '书签', value: '书签' },
  { label: '无', value: '无' },
]

const autoReadingMethods = [
  { label: '像素滚动', value: '像素滚动' },
  { label: '行滚动', value: '行滚动' },
  { label: '时间滚动', value: '时间滚动' },
]
</script>

<template>
  <el-dialog
    v-model="props.visible"
    :title="dialogTitle"
    width="700px"
    :append-to-body="false"
    @close="handleClose"
  >
    <el-divider>{{ currentBookName }}</el-divider>

    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="阅读主题" name="theme">
        <div class="setting-section">
          <div class="setting-label">界面模式</div>
          <el-button-group>
            <el-button :type="localConfig.themeType === 'day' ? 'primary' : 'info'" @click="toggleDayMode">白天</el-button>
            <el-button :type="localConfig.themeType === 'night' ? 'primary' : 'info'" @click="toggleNightMode">夜间</el-button>
          </el-button-group>
        </div>

        <div class="setting-section">
          <div class="setting-label">主题风格</div>
          <div class="theme-grid">
            <div
              v-for="(theme, idx) in isCustomTheme ? [999] : nightThemes"
              :key="idx"
              class="theme-item"
              :class="{ active: localConfig.theme === idx }"
              @click="applyTheme(idx)"
            >
              <div
                class="theme-swatch"
                :style="{
                  background: idx === 999 ? 'var(--bg-page)' : themes[idx].body,
                }"
              />
              <div class="theme-preview" :style="{ background: idx === 999 ? 'var(--bg-page)' : themes[idx].content }">
                <div class="theme-dot" :style="{ color: idx === 999 ? '#666' : '#000' }">T</div>
              </div>
            </div>
            <div
              v-if="isCustomTheme"
              class="theme-item active"
            >
              <div class="theme-swatch" :style="{ background: localConfig.bodyColor }" />
            </div>
          </div>

          <div v-if="isCustomTheme" class="custom-theme-colors">
            <el-form-item label="背景色">
              <el-color-picker v-model="localConfig.bodyColor" :predefine="['#eadfca', '#121212', '#f5f7fa']" />
            </el-form-item>
            <el-form-item label="内容色">
              <el-color-picker v-model="localConfig.contentColor" :predefine="['#fff', '#171717', '#f5e4e4']" />
            </el-form-item>
            <el-form-item label="弹出色">
              <el-color-picker v-model="localConfig.popupColor" :predefine="['#ede7da', '#121212', '#faeceb']" />
            </el-form-item>
          </div>

          <el-form-item label="自定义背景图">
            <el-input v-model="localConfig.contentBGImg" placeholder="输入背景图片URL或本地路径" />
          </el-form-item>
        </div>
      </el-tab-pane>

      <el-tab-pane label="字体设置" name="font">
        <el-form-item label="字体">
          <el-select v-model="localConfig.font" placeholder="选择字体" style="width: 100%">
            <el-option
              v-for="(font, idx) in fonts"
              :key="idx"
              :label="font.name"
              :value="idx"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="字号">
          <el-slider v-model="localConfig.fontSize" :min="10" :max="40" />
          <span>{{ localConfig.fontSize }}px</span>
        </el-form-item>

        <el-form-item label="字重">
          <el-slider v-model="localConfig.fontWeight" :min="100" :max="900" :step="100" />
          <span>{{ localConfig.fontWeight }}</span>
        </el-form-item>

        <el-form-item label="字色">
          <el-color-picker v-model="localConfig.fontColor" />
        </el-form-item>

        <el-form-item label="行高">
          <el-slider v-model="localConfig.lineHeight" :min="1" :max="3" :step="0.1" />
          <span>{{ localConfig.lineHeight }}</span>
        </el-form-item>
      </el-tab-pane>

      <el-tab-pane label="段落设置" name="paragraph">
        <el-form-item label="阅读方式">
          <el-select v-model="localConfig.readMethod" placeholder="选择阅读方式" style="width: 100%">
            <el-option
              v-for="mode in readModes"
              :key="mode.value"
              :label="mode.label"
              :value="mode.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="点击方式">
          <el-select v-model="localConfig.clickMethod" placeholder="选择点击方式" style="width: 100%">
            <el-option
              v-for="method in clickMethods"
              :key="method.value"
              :label="method.label"
              :value="method.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="页面模式">
          <el-select v-model="localConfig.pageMode" placeholder="选择页面模式" style="width: 100%">
            <el-option
              v-for="mode in pageModes"
              :key="mode.value"
              :label="mode.label"
              :value="mode.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="EPUB 模式" v-if="false">
          <el-select v-model="localConfig.epubMode" placeholder="选择 EPUB 模式" style="width: 100%">
            <el-option
              v-for="mode in epubModes"
              :key="mode.value"
              :label="mode.label"
              :value="mode.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="选中文字动作">
          <el-select v-model="localConfig.selectionAction" placeholder="选择动作" style="width: 100%">
            <el-option
              v-for="action in selectionActions"
              :key="action.value"
              :label="action.label"
              :value="action.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="段间距">
          <el-slider v-model="localConfig.paragraphSpace" :min="0" :max="1" :step="0.1" />
          <span>{{ localConfig.paragraphSpace }}</span>
        </el-form-item>

        <el-form-item label="左上内边距">
          <el-input-number v-model.number="localConfig.topPadding" :min="0" :max="100" />
        </el-form-item>

        <el-form-item label="右下内边距">
          <el-input-number v-model.number="localConfig.bottomPadding" :min="0" :max="100" />
        </el-form-item>

        <el-form-item label="横向内边距">
          <el-input-number v-model.number="localConfig.horizontalPadding" :min="0" :max="100" />
        </el-form-item>

        <el-form-item label="动画时长(ms)">
          <el-input-number v-model.number="localConfig.animateMSTime" :min="0" :max="2000" :step="50" />
        </el-form-item>

        <el-form-item label="自动阅读方式">
          <el-select v-model="localConfig.autoReadingMethod" placeholder="选择方式" style="width: 100%">
            <el-option
              v-for="method in autoReadingMethods"
              :key="method.value"
              :label="method.label"
              :value="method.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="自动阅读像素">
          <el-input-number v-model.number="localConfig.autoReadingPixel" :min="1" :max="100" :step="1" />
        </el-form-item>

        <el-form-item label="自动阅读行时间(ms)">
          <el-input-number v-model.number="localConfig.autoReadingLineTime" :min="100" :max="10000" :step="100" />
        </el-form-item>

        <el-form-item label="阅读宽度">
          <el-input-number v-model.number="localConfig.readWidth" :min="200" :max="2000" :step="10" />
        </el-form-item>

        <el-form-item label="章节请求超时(秒)">
          <el-input-number v-model.number="localConfig.chapterRequestTimeout" :min="5" :max="60" :step="1" />
        </el-form-item>

        <el-form-item label="快捷键模式">
          <el-select v-model="localConfig.quickKeyMode" placeholder="选择模式" style="width: 100%">
            <el-option label="默认" value="默认" />
            <el-option label="自定义" value="自定义" />
          </el-select>
        </el-form-item>
      </el-tab-pane>

      <el-tab-pane label="语音设置" name="speech">
        <el-form :model="speechConfig" label-width="100px">
          <el-form-item label="语音类型">
            <el-select v-model="speechConfig.ttsType" style="width: 100%">
              <el-option v-for="t in ttsTypes" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="speechConfig.ttsType === 'edge'" label="方言">
            <el-select v-model="selectedDialect" style="width: 100%" placeholder="选择方言">
              <el-option v-for="d in edgeDialects" :key="d" :label="d" :value="d" />
            </el-select>
          </el-form-item>
          <el-form-item label="选择语音">
            <el-select v-model="speechConfig.voiceName" style="width: 100%" placeholder="选择语音">
              <el-option
                v-for="voice in (speechConfig.ttsType === 'edge' ? ttsVoiceList : localVoiceOptions)"
                :key="voice.name"
                :label="speechConfig.ttsType === 'edge' ? `${voice.LocalName} (${voice.name})` : voice.name"
                :value="voice.name"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="语速">
            <el-slider v-model="speechConfig.speechRate" :min="0.5" :max="2" :step="0.1" show-input />
          </el-form-item>
          <el-form-item label="语调">
            <el-slider v-model="speechConfig.speechPitch" :min="0" :max="2" :step="0.1" show-input />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="自定义方案" name="custom">
        <div class="custom-config-section">
          <div class="setting-label">已有方案</div>
          <el-table :data="customConfigList" style="width: 100%" border>
            <el-table-column prop="customConfig" label="方案名称" width="200" />
            <el-table-column prop="configDefaultType" label="类型" width="120" />
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button type="primary" size="small" text @click="selectCustomConfig(row.customConfig || row.name)">应用</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="setting-label" style="margin-top: 20px;">保存当前为方案</div>
          <el-form-item label="方案名称">
            <el-input v-model="customConfigName" placeholder="输入方案名称" />
          </el-form-item>
          <el-button type="primary" @click="saveCustomConfig">保存为自定义方案</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
      <el-button type="primary" @click="handleClose">应用</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.setting-section {
  margin-bottom: 20px;
}
.setting-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 10px;
  padding-left: 2px;
}
.theme-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.theme-item {
  width: 50px;
  text-align: center;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 4px;
  padding: 4px;
}
.theme-item.active {
  border-color: var(--el-color-primary);
}
.theme-swatch {
  width: 100%;
  height: 16px;
  border-radius: 2px;
  margin-bottom: 2px;
}
.theme-preview {
  width: 100%;
  height: 24px;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.custom-theme-colors .el-form-item {
  margin-bottom: 10px;
}
.custom-config-section .setting-label {
  margin-bottom: 10px;
}
</style>
