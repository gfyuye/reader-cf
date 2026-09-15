<script setup lang="ts">
import { ref } from 'vue'
import { Setting, Lock, Bell, Coin as Database, Location as Globe } from '@element-plus/icons-vue'

const activeSection = ref('general')
const minPasswordLength = ref(8)
</script>

<template>
  <div class="settings-container">
    <h2>设置</h2>
    <el-row :gutter="20">
      <el-col :span="8">
        <el-menu :default-active="activeSection" @select="(key: string) => activeSection = key">
          <el-menu-item index="general">
            <el-icon><Setting /></el-icon>
            常规设置
          </el-menu-item>
          <el-menu-item index="security">
            <el-icon><Lock /></el-icon>
            安全设置
          </el-menu-item>
          <el-menu-item index="database">
            <el-icon><Database /></el-icon>
            数据管理
          </el-menu-item>
        </el-menu>
      </el-col>
      <el-col :span="16">
        <el-card>
          <template v-if="activeSection === 'general'">
            <h3>常规设置</h3>
            <el-form :model="{ showUI: false, debug: false, cacheChapter: true }" label-width="140px">
              <el-form-item label="显示界面">
                <el-switch />
              </el-form-item>
              <el-form-item label="调试日志">
                <el-switch />
              </el-form-item>
              <el-form-item label="缓存章节内容">
                <el-switch />
              </el-form-item>
            </el-form>
          </template>
          <template v-else-if="activeSection === 'security'">
            <h3>安全设置</h3>
            <el-form label-width="140px">
              <el-form-item label="启用登录">
                <el-switch />
              </el-form-item>
              <el-form-item label="管理密码">
                <el-input placeholder="设置管理密码" show-password />
              </el-form-item>
              <el-form-item label="邀请码">
                <el-input placeholder="设置邀请码(可选)" />
              </el-form-item>
              <el-form-item label="最小密码长度">
                <el-input-number :min="6" :max="32" v-model="minPasswordLength" />
              </el-form-item>
            </el-form>
          </template>
          <template v-else-if="activeSection === 'database'">
            <h3>数据管理</h3>
            <el-button type="primary" plain style="margin-right: 8px;">备份数据</el-button>
            <el-button type="warning" plain style="margin-right: 8px;">恢复数据</el-button>
            <el-button type="danger" plain>清除缓存</el-button>
          </template>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.settings-container h2 {
  margin: 0 0 20px 0;
}
.settings-container h3 {
  margin: 0 0 16px 0;
}
</style>
