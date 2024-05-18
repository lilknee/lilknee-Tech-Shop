// pages/sc/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    password:'',
    fileList: [],
    iamgelist:[],
    name:'',
    openid:'',
    jieshao:'',
    dizhi:'',
    jiage:'',
    value:'',
    thumb:'',
  },

  shangc(){
    wx.request({
      url: 'https://store.lilknee.xyz/setdb',
      method:'POST',
      data:{
        openid:this.data.openid,
        title:this.data.name,
        descs:this.data.jieshao,
        price:this.data.jiage,
        thumb:this.data.thumb,
        download:this.data.dizhi
      },
      success: () => {
        wx.request({
          url: 'https://store.lilknee.xyz/setimagedb',
          method:'POST',
          data:{
            name:this.data.name,
            dizhi:this.data.iamgelist
          },
          success:()=>{
            this.setData({iamgelist:[]})
          }
        })
        this.initData();
      }
    })
    
  },

 
    afterRead(event) {
       // 根据实际文件路径调整引入路径
      const { file } = event.detail;
      console.log(file.tempFilePath)
      const url=file.tempFilePath
      const result = url.match(/\/([^/]+)$/);

      if (result && result.length > 1) {
        // result[0] 匹配到的完整字符串
        // result[1] 匹配到的最后一个 / 后面的内容
        const extractedValue = result[1];
        const finalUrl = `https://minio.lilknee.xyz/${extractedValue}`;
        console.log(finalUrl); 
        this.setData({thumb:finalUrl})
        this.data.iamgelist.push({finalUrl}); // 添加新文件到 fileList
          this.setData({ iamgelist:this.data.iamgelist });
          console.log(this.data.iamgelist)
      } else {
          console.log('未匹配到指定模式');
        }


      const { fileList } = this.data;
      
      wx.uploadFile({
        url: 'https://store.lilknee.xyz/upload',
        formData: {
          size: file.size.toString(), // 将文件大小添加到 formData
          contentType: 'image/jpg/png' // 也可以将其他参数添加到 formData
        }, // 仅为示例，非真实的接口地址
        filePath: file.url,
        name: 'file',
        
        
        success: (res) => {
          // 上传完成需要更新 fileList
          console.log(res)
          fileList.push({ ...file, url: res.data }); // 添加新文件到 fileList
          this.setData({ fileList });
          console.log(fileList) // 更新数据
        },
        fail: (error) => {
          console.log('上传失败', error);
          // 处理上传失败的情况
        }
      });
    },


  onChange(event) {
    // event.detail 为当前输入的值
    this.setData({name:event.detail})
  },
  getjs(event) {
    // event.detail 为当前输入的值
    this.setData({jieshao:event.detail})
  },
  getdizhi(event) {
    // event.detail 为当前输入的值
    this.setData({dizhi:event.detail})
  },
  getpc(event) {
    // event.detail 为当前输入的值
    this.setData({jiage:event.detail})
  },

   dy:function(){
    console.log(this.data.username)
   },

   initData: function() {
    this.setData({
      password: '',
      fileList: [],
      imagelist: [],
      name: '',
      openid: '',
      jieshao: '',
      jiage: '',
      value: '',
      thumb: '',
      dizhi:''
    });
  },
  
  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.initData();
   
  

  wx.login({
    success: res => {
      // 发送 res.code 到后台换取 openId, sessionKey, unionId
      wx.request({
        url: 'https://store.lilknee.xyz/getOpenId',
        method:'POST',
        data:{
          code:res.code
        },
        success: (response)=>{
          this.setData({openid:response.data[1].data.openid})
          console.log(response.data)
          
        },
      })
      
    }
  })
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})