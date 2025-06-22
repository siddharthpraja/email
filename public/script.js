document.addEventListener('DOMContentLoaded', function() {
  const baseUrl = window.location.origin;
  
  function showAlert(elementId, message, isError = false) {
    const element = document.getElementById(elementId);
    element.innerHTML = message;
    element.style.display = 'block';
    element.className = isError ? 'alert alert-danger' : 'alert alert-success';
    
    setTimeout(() => {
      element.style.display = 'none';
    }, 5000);
  }
  
  // Handle unsubscribe page
  if (document.getElementById('confirmUnsubscribe')) {
    const urlParams = new URLSearchParams(window.location.search);
    const email = urlParams.get('email');
    
    if (email) {
      document.getElementById('unsubscribeEmail').textContent = decodeURIComponent(email);
      
      document.getElementById('confirmUnsubscribe').addEventListener('click', () => {
        fetch('/api/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email: decodeURIComponent(email) })
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            document.getElementById('unsubscribeContent').style.display = 'none';
            document.getElementById('unsubscribeSuccess').style.display = 'block';
          } else {
            throw new Error('Unsubscribe failed');
          }
        })
        .catch(error => {
          document.getElementById('unsubscribeContent').style.display = 'none';
          document.getElementById('unsubscribeError').style.display = 'block';
          document.getElementById('errorMessage').textContent = error.message;
        });
      });
    } else {
      document.getElementById('unsubscribeContent').style.display = 'none';
      document.getElementById('unsubscribeError').style.display = 'block';
      document.getElementById('errorMessage').textContent = 'No email address provided';
    }
  }
  
  // Handle index page
  if (document.getElementById('uploadForm')) {
    const uploadForm = document.getElementById('uploadForm');
    const scheduleForm = document.getElementById('scheduleForm');
    const scheduleSection = document.getElementById('scheduleSection');
    const selectedFilename = document.getElementById('selectedFilename');
    const emailPreview = document.getElementById('emailPreview');
    const messageInput = document.getElementById('message');
    const formatBtn = document.getElementById('formatBtn');
    
    // Upload Excel file
    uploadForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const formData = new FormData();
      formData.append('excelFile', document.getElementById('excelFile').files[0]);
      
      fetch('/api/upload', {
        method: 'POST',
        body: formData
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          showAlert('uploadStatus', `File "${data.filename}" uploaded successfully with ${data.emailCount} emails.`, false);
          selectedFilename.value = data.filename;
          scheduleSection.style.display = 'block';
        } else {
          throw new Error(data.error || 'Upload failed');
        }
      })
      .catch(error => {
        showAlert('uploadStatus', error.message, true);
      });
    });
    
    // Format message with AI
    formatBtn.addEventListener('click', function() {
      const message = messageInput.value.trim();
      
      if (!message) {
        showAlert('uploadStatus', 'Please enter a message to format', true);
        return;
      }
      
      fetch('/api/format', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message })
      })
      .then(response => response.json())
      .then(data => {
        if (data.formatted) {
          messageInput.value = data.formatted;
          updateEmailPreview();
        } else {
          throw new Error(data.error || 'Formatting failed');
        }
      })
      .catch(error => {
        showAlert('uploadStatus', error.message, true);
      });
    });
    
    // Update email preview when message changes
    messageInput.addEventListener('input', updateEmailPreview);
    document.getElementById('subject').addEventListener('input', updateEmailPreview);
    
    function updateEmailPreview() {
      const subject = document.getElementById('subject').value;
      const message = messageInput.value;
      
      if (subject || message) {
        emailPreview.innerHTML = `
          <strong>Subject:</strong> ${subject || '(No subject)'}
          <hr>
          ${message || '(No message)'}
          <hr>
          <small class="text-muted">Unsubscribe link will be automatically added to each email.</small>
        `;
      } else {
        emailPreview.innerHTML = '<em>Preview will appear here when you enter a subject and message.</em>';
      }
    }
    
    // Schedule emails
    scheduleForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const formData = new FormData();
      formData.append('filename', selectedFilename.value);
      formData.append('subject', document.getElementById('subject').value);
      formData.append('message', messageInput.value);
      const localDate = new Date(document.getElementById('scheduleDate').value);
      formData.append('scheduleDate', localDate.toISOString());
      formData.append('repetition', document.getElementById('repetition').value);
      
      // Add attachments if any
      const attachments = document.getElementById('attachments').files;
      for (let i = 0; i < attachments.length; i++) {
        formData.append('attachments', attachments[i]);
      }
      
      fetch('/api/schedule', {
        method: 'POST',
        body: formData
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          const date = new Date(data.scheduledDate);
          const repetitionText = data.repetition ? ` (repeating ${data.repetition})` : '';
          showAlert('scheduleStatus', `Emails scheduled for ${date.toLocaleString()}${repetitionText}`, false);
          scheduleForm.reset();
          scheduleSection.style.display = 'none';
        } else {
          throw new Error(data.error || 'Scheduling failed');
        }
      })
      .catch(error => {
        showAlert('scheduleStatus', error.message, true);
      });
    });
  }
  
  // Handle history page
  if (document.getElementById('fileList')) {
    const fileList = document.getElementById('fileList');
    const jobList = document.getElementById('jobList');
    const emailListModal = new bootstrap.Modal(document.getElementById('emailListModal'));
    // const jobDetailsModal = new bootstrap.Modal(document.getElementById('jobDetailsModal'));
    // alert("test4")
    // let currentJobId = null;
    // alert("test5")
    
    // Load files and jobs
    function loadData() {
      // Load files
      fetch('/api/files')
        .then(response => response.json())
        .then(files => {
          fileList.innerHTML = files.map(file => `
            <tr data-filename="${file.storedFilename}">
              <td>${file.filename}</td>
              <td>${new Date(file.uploadDate).toLocaleString()}</td>
              <td>${file.emailCount}</td>
              <td>
                <button class="btn btn-sm btn-outline-primary view-emails">View</button>
                <a href="/api/files/${encodeURIComponent(file.storedFilename)}/download" 
                   class="btn btn-sm btn-outline-success">Download</a>
                <button class="btn btn-sm btn-outline-danger delete-file">Delete</button>
              </td>
            </tr>
          `).join('');
          
          // Add event listeners for files
          document.querySelectorAll('.view-emails').forEach(btn => {
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              const filename = this.closest('tr').getAttribute('data-filename');
              showEmailList(filename);
            });
          });
          
          document.querySelectorAll('.delete-file').forEach(btn => {
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              const filename = this.closest('tr').getAttribute('data-filename');
              if (confirm(`Are you sure you want to delete this file?`)) {
                deleteFile(filename);
              }
            });
          });
        })
        .catch(error => {
          console.error('Error loading files:', error);
          fileList.innerHTML = '<tr><td colspan="4" class="text-danger">Error loading files</td></tr>';
        });
      
      // Load jobs
      fetch('/api/jobs')
        .then(response => response.json())
        .then(jobs => {
          jobList.innerHTML = jobs.map(job => `
            <tr data-job-id="${job.jobId}">
              <td>${job.filename}</td>
              <td>${new Date(job.scheduledDate).toLocaleString()}</td>
              <td>${job.repetition || 'None'}</td>
              <td>${job.subject}</td>
              <td>
                <button class="btn btn-sm btn-outline-danger cancel-job">Cancel</button>
              </td>
            </tr>
          `).join('');
          
          // Add event listeners for jobs
          document.querySelectorAll('.cancel-job').forEach(btn => {
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              const jobId = this.closest('tr').getAttribute('data-job-id');
              if (confirm('Are you sure you want to cancel this job?')) {
                cancelJob(jobId);
              }
            });
          });
        })
        .catch(error => {
          console.error('Error loading jobs:', error);
          jobList.innerHTML = '<tr><td colspan="5" class="text-danger">Error loading jobs</td></tr>';
        });
    }
    
    function showEmailList(storedFilename) {
      fetch(`/api/files/${encodeURIComponent(storedFilename)}`)
        .then(response => response.json())
        .then(file => {
          document.getElementById('emailListModalTitle').textContent = `Emails in ${file.filename}`;
          document.getElementById('emailListContent').innerHTML = `
            <p><strong>Uploaded:</strong> ${new Date(file.uploadDate).toLocaleString()}</p>
            <p><strong>Total Emails:</strong> ${file.emails.length}</p>
            <div style="max-height: 400px; overflow-y: auto;">
              <ul class="list-group">
                ${file.emails.map(email => `<li class="list-group-item">${email}</li>`).join('')}
              </ul>
            </div>
          `;
          emailListModal.show();
        })
        .catch(error => {
          console.error('Error loading email list:', error);
          alert('Error loading email list');
        });
    }
    
    function deleteFile(storedFilename) {
      fetch(`/api/files/${encodeURIComponent(storedFilename)}`, {
        method: 'DELETE'
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          loadData();
        } else {
          throw new Error('Delete failed');
        }
      })
      .catch(error => {
        console.error('Error deleting file:', error);
        alert('Error deleting file');
      });
    }
    
    function cancelJob(jobId) {
      fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE'
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          loadData();
        } else {
          throw new Error('Cancel failed');
        }
      })
      .catch(error => {
        console.error('Error canceling job:', error);
        alert('Error canceling job');
      });
    }
    
    loadData();
    
    setInterval(loadData, 30000);
  }
});