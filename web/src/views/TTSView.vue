<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus, Delete, Microphone, Setting, VideoPlay, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTag, ElForm, ElSlider } from 'element-plus'
import { getHttpTTSList, saveHttpTTS, saveHttpTTSList, deleteHttpTTS as apiDelete, deleteHttpTTSMulti } from '@/api/other'
import { textToSpeech } from '@/api/backup'
import { useNotify } from '@/utils/helpers'
import type { HttpTTS } from '@/api/types'
import { useSettingsStore } from '@/stores/settings'
import { ttsVoiceList, type TtsVoice } from '@/plugins/ttsVoices'

const { success, error } = useNotify()
const settingsStore = useSettingsStore()

const ttsList = ref<HttpTTS[]>([])
const showAdd = ref(false)
const editingTTS = ref<HttpTTS | null>(null)
const ttsForm = ref<Partial<HttpTTS>>({})
const loading = ref(false)
const ttsPlaying = ref(false)
const ttsContent = ref('')
const showTTSConfig = ref(false)
const selectedDialect = ref('全部')
const ttsType = ref<'local' | 'edge' | 'httpTTS'>('local')
const localVoices = ref<SpeechSynthesisVoice[]>([])

const filteredVoices = computed(() => {
  if (ttsType.value === 'local') {
    return localVoices.value
  }
  if (ttsType.value === 'edge') {
    if (!selectedDialect.value || selectedDialect.value === '全部') return ttsVoiceList
    return ttsVoiceList.filter(v => v.dialect === selectedDialect.value)
  }
  return []
})

const dialects = computed(() => {
  const ds = new Set<string>()
  ttsVoiceList.forEach(v => ds.add(v.dialect))
  return ['全部', ...Array.from(ds).sort()]
})

const voiceOptions = computed(() => {
  return filteredVoices.value.map(v => ({
    label: ttsType.value === 'edge' ? `${(v as TtsVoice).LocalName} (${(v as TtsVoice).name})` : `${(v as TtsVoice).name}`,
    value: ttsType.value === 'edge' ? (v as TtsVoice).name : (v as TtsVoice).name,
  }))
})

onMounted(() => {
  loadList()
  fetchLocalVoices()
})

async function loadList() {
  loading.value = true
  try {
    const res = await getHttpTTSList()
    if (res.isSuccess) {
      ttsList.value = (res.data as HttpTTS[]) || []
    }
  } finally {
    loading.value = false
  }
}

function fetchLocalVoices() {
  if (!('speechSynthesis' in window)) return
  try {
    localVoices.value = window.speechSynthesis.getVoices()
  } catch { /* ignore */ }
  if ('onvoiceschanged' in window.speechSynthesis) {
    ;(window.speechSynthesis as any).onvoiceschanged = () => {
      try {
        localVoices.value = window.speechSynthesis.getVoices()
      } catch { /* ignore */ }
    }
  }
}

async function addTTS() {
  if (!ttsForm.value.name || !ttsForm.value.url) {
    error('名称和链接不能为空')
    return
  }
  const res = await saveHttpTTS({
    ...ttsForm.value,
    contentType: ttsForm.value.contentType || 'application/json',
    header: ttsForm.value.header || '',
  })
  if (res.isSuccess) {
    success('保存成功')
    showAdd.value = false
    ttsForm.value = {}
    editingTTS.value = null
    loadList()
  } else if (res.errorMsg) {
    error(res.errorMsg)
  }
}

async function editTTS(tts: HttpTTS) {
  editingTTS.value = tts
  ttsForm.value = { ...tts }
  showAdd.value = true
}

async function removeTTS(id: string) {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    const res = await apiDelete(id)
    if (res.isSuccess) {
      success('删除成功')
      loadList()
    }
  } catch { /* cancelled */ }
}

async function playTTS() {
  if (!ttsContent.value.trim()) {
    error('请输入要朗读的文本')
    return
  }
  if (!ttsList.value.length) {
    error('请先添加HttpTTS配置')
    return
  }
  ttsPlaying.value = true
  try {
    const res = await textToSpeech({
      ttsName: ttsList.value[0].name,
      content: ttsContent.value,
      ...settingsStore.speechVoiceConfig,
    })
    if (res.isSuccess) {
      success('TTS提交成功')
    } else if (res.errorMsg) {
      error(res.errorMsg)
    }
  } catch (e) {
    error('TTS播放失败')
  } finally {
    ttsPlaying.value = false
  }
}

function updateVoiceRate(pitch: number) {
  settingsStore.setSpeechVoiceConfig({ speechPitch: pitch })
}

function updateVoiceRate2(rate: number) {
  settingsStore.setSpeechVoiceConfig({ speechRate: rate })
}
</script>

<template>
  <div class="tts-container">
    <el-row :gutter="20" style="margin-bottom: 16px;">
      <el-col :span="18"><h3>HttpTTS 配置</h3></el-col>
      <el-col :span="6" style="text-align: right;">
        <el-button type="primary" :icon="Plus" @click="ttsForm = {}; editingTTS = null; showAdd = true">
          添加
        </el-button>
      </el-col>
    </el-row>

    <el-table :data="ttsList" stripe v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="名称" min-width="150" />
      <el-table-column prop="url" label="URL" min-width="250" />
      <el-table-column prop="contentType" label="Content-Type" width="140" />
      <el-table-column prop="header" label="请求头" width="140" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button :icon="Setting" size="small" text @click="editTTS(row)" />
          <el-button :icon="Delete" size="small" type="danger" text @click="removeTTS(row.id)" />
        </template>
      </el-table-column>
    </el-table>

    <el-divider>语音设置</el-divider>
    <div class="voice-settings">
      <el-form :model="settingsStore.speechVoiceConfig" label-width="80px">
        <el-form-item label="语音类型">
          <el-select v-model="ttsType" style="width: 100%">
            <el-option label="本地浏览器" value="local" />
            <el-option label="Edge TTS" value="edge" />
            <el-option label="HttpTTS" value="httpTTS" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="ttsType === 'edge'" label="方言">
          <el-select v-model="selectedDialect" style="width: 100%">
            <el-option v-for="d in dialects" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="选择语音">
          <el-select v-model="settingsStore.speechVoiceConfig.voiceName" style="width: 100%" placeholder="选择语音">
            <el-option
              v-for="voice in voiceOptions"
              :key="voice.value"
              :label="voice.label"
              :value="voice.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="语速">
          <el-slider
            v-model="settingsStore.speechVoiceConfig.speechRate"
            :min="0.5"
            :max="2"
            :step="0.1"
            show-input
          />
        </el-form-item>
        <el-form-item label="语调">
          <el-slider
            v-model="settingsStore.speechVoiceConfig.speechPitch"
            :min="0"
            :max="2"
            :step="0.1"
            show-input
          />
        </el-form-item>
      </el-form>
    </div>

    <el-divider>本地语音朗读测试</el-divider>
    <div class="tts-test">
      <el-input
        v-model="ttsContent"
        type="textarea"
        :rows="4"
        placeholder="请输入要朗读的文本内容..."
      />
      <el-button
        type="primary"
        :loading="ttsPlaying"
        :icon="Microphone"
        @click="playTTS"
        style="margin-top: 12px;"
      >
        {{ ttsPlaying ? '播放中...' : '开始朗读' }}
      </el-button>
    </div>

    <el-dialog
      v-model="showAdd"
      :title="editingTTS ? '编辑HttpTTS' : '添加HttpTTS'"
      width="600px"
      :append-to-body="false"
    >
      <el-form :model="ttsForm" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="ttsForm.name" placeholder="TTS名称" />
        </el-form-item>
        <el-form-item label="URL">
          <el-input v-model="ttsForm.url" placeholder="TTS接口URL" />
        </el-form-item>
        <el-form-item label="Content-Type">
          <el-select v-model="ttsForm.contentType" placeholder="选择请求类型" style="width: 100%">
            <el-option label="application/json" value="application/json" />
            <el-option label="application/x-www-form-urlencoded" value="application/x-www-form-urlencoded" />
            <el-option label="text/plain" value="text/plain" />
          </el-select>
        </el-form-item>
        <el-form-item label="请求头">
          <el-input v-model="ttsForm.header" type="textarea" :rows="2" placeholder='如：{"Authorization": "Bearer token"}' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="addTTS">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tts-container {
  padding: 0;
}
.tts-test {
  margin-top: 16px;
}
.voice-settings {
  margin-bottom: 16px;
}
.voice-settings .el-form-item {
  margin-bottom: 12px;
}
</style>
